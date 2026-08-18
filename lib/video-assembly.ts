import {
  AppendOnlyStreamTarget,
  BufferSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MP4,
  Mp4OutputFormat,
  Output,
} from "mediabunny";

const MULTIPART_CHUNK_SIZE = 8 * 1024 * 1024;

type AssemblyMetadata = {
  projectId: string;
  revision: number;
  model: string;
  ratio: string;
  resolution: string;
  fps: number;
  width: number;
  height: number;
};

export type VideoAssemblyResult = {
  objectKey: string;
  duration: number;
  size: number;
  segmentCount: number;
};

/**
 * Remuxes already-compatible Seedance MP4 segments in order. It does not decode
 * or re-encode the media, so the model's native image quality and 24 fps cadence
 * are preserved. The result is streamed to R2 as fragmented MP4 to avoid holding
 * a long final video in Worker memory.
 */
export async function assembleVideoSegments(
  storage: R2Bucket,
  segmentKeys: string[],
  outputKey: string,
  metadata: AssemblyMetadata,
): Promise<VideoAssemblyResult> {
  if (!segmentKeys.length) throw new Error("没有可合成的视频片段");

  const first = await readInput(storage, segmentKeys[0]);
  const firstVideo = await first.input.getPrimaryVideoTrack();
  if (!firstVideo) throw new Error("第1个视频片段没有视频轨道");
  const videoCodec = await firstVideo.getCodec();
  const videoConfig = await firstVideo.getDecoderConfig();
  if (!videoCodec || !videoConfig) throw new Error("无法读取第1个片段的视频编码配置");
  const displayWidth = await firstVideo.getDisplayWidth();
  const displayHeight = await firstVideo.getDisplayHeight();
  const firstRotation = await firstVideo.getRotation();
  if (displayWidth !== metadata.width || displayHeight !== metadata.height) {
    throw new Error(`视频片段实际尺寸 ${displayWidth}×${displayHeight} 与目标 ${metadata.width}×${metadata.height} 不一致`);
  }
  const frameRate = await firstVideo.computeFrameRateMetrics();
  if (Math.abs(frameRate.bestGuessFrameRate - metadata.fps) > 0.01) {
    throw new Error(`视频片段实际帧率 ${frameRate.bestGuessFrameRate} fps 与目标 ${metadata.fps} fps 不一致`);
  }
  const firstAudio = await first.input.getPrimaryAudioTrack();
  const audioCodec = await firstAudio?.getCodec() ?? null;
  const audioConfig = await firstAudio?.getDecoderConfig() ?? null;

  const upload = await storage.createMultipartUpload(outputKey, {
    httpMetadata: { contentType: "video/mp4" },
    customMetadata: {
      projectId: metadata.projectId,
      revision: String(metadata.revision),
      source: "seedance-2.0-segment-assembly",
      model: metadata.model,
      ratio: metadata.ratio,
      resolution: metadata.resolution,
      fps: String(metadata.fps),
      dimensions: `${metadata.width}x${metadata.height}`,
      segments: String(segmentKeys.length),
    },
  });
  const uploadTarget = multipartWritable(upload);
  const videoSource = new EncodedVideoPacketSource(videoCodec);
  const audioSource = audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "fragmented", minimumFragmentDuration: 1 }),
    target: new AppendOnlyStreamTarget(uploadTarget.writable),
  });
  output.addVideoTrack(videoSource, {
    decoderConfig: videoConfig,
    rotation: firstRotation,
    frameRate: metadata.fps,
  });
  if (audioSource && audioConfig) output.addAudioTrack(audioSource, { decoderConfig: audioConfig });

  let timelineOffset = 0;
  let videoSequence = 0;
  let audioSequence = 0;
  try {
    await output.start();
    for (let index = 0; index < segmentKeys.length; index += 1) {
      const loaded = index === 0 ? first : await readInput(storage, segmentKeys[index]);
      try {
        const videoTrack = await loaded.input.getPrimaryVideoTrack();
        if (!videoTrack) throw new Error(`第${index + 1}个视频片段没有视频轨道`);
        const segmentVideoCodec = await videoTrack.getCodec();
        const segmentVideoConfig = await videoTrack.getDecoderConfig();
        if (segmentVideoCodec !== videoCodec || !segmentVideoConfig) throw new Error(`第${index + 1}个片段的视频编码与首段不兼容`);
        if (segmentVideoConfig.codedWidth !== videoConfig.codedWidth || segmentVideoConfig.codedHeight !== videoConfig.codedHeight) {
          throw new Error(`第${index + 1}个片段的画面尺寸与首段不一致`);
        }
        if (await videoTrack.getRotation() !== firstRotation) throw new Error(`第${index + 1}个片段的画面旋转信息与首段不一致`);

        const audioTrack = await loaded.input.getPrimaryAudioTrack();
        if (Boolean(audioTrack) !== Boolean(audioSource)) throw new Error(`第${index + 1}个片段的音轨结构与首段不一致`);
        const segmentAudioCodec = await audioTrack?.getCodec() ?? null;
        const segmentAudioConfig = await audioTrack?.getDecoderConfig() ?? null;
        if (audioTrack && (segmentAudioCodec !== audioCodec || !segmentAudioConfig)) throw new Error(`第${index + 1}个片段的音频编码与首段不兼容`);

        const tracks = audioTrack ? [videoTrack, audioTrack] : [videoTrack];
        const firstTimestamp = await loaded.input.getFirstTimestamp(tracks);
        const duration = await loaded.input.computeDuration(tracks);
        if (!Number.isFinite(duration) || duration <= firstTimestamp) throw new Error(`第${index + 1}个片段时长无效`);

        const writeVideo = (async () => {
          let firstPacket = true;
          for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
            await videoSource.add(packet.clone({
              timestamp: timelineOffset + Math.max(0, packet.timestamp - firstTimestamp),
              sequenceNumber: videoSequence++,
            }), firstPacket ? { decoderConfig: segmentVideoConfig } : undefined);
            firstPacket = false;
          }
        })();
        const writeAudio = audioTrack && audioSource && segmentAudioConfig
          ? (async () => {
              let firstPacket = true;
              for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
                await audioSource.add(packet.clone({
                  timestamp: timelineOffset + Math.max(0, packet.timestamp - firstTimestamp),
                  sequenceNumber: audioSequence++,
                }), firstPacket ? { decoderConfig: segmentAudioConfig } : undefined);
                firstPacket = false;
              }
            })()
          : Promise.resolve();
        await Promise.all([writeVideo, writeAudio]);
        timelineOffset += duration - firstTimestamp;
      } finally {
        loaded.input.dispose();
      }
    }
    await output.finalize();
    const object = await uploadTarget.completed;
    if (!object || object.size <= 0) throw new Error("合成视频归档校验失败");
    return {
      objectKey: outputKey,
      duration: Math.round(timelineOffset * 1000) / 1000,
      size: object.size,
      segmentCount: segmentKeys.length,
    };
  } catch (error) {
    if (output.state !== "finalized" && output.state !== "canceled") {
      try { await output.cancel(); } catch { /* preserve the original error */ }
    }
    await uploadTarget.abort();
    throw error;
  }
}

async function readInput(storage: R2Bucket, key: string) {
  const object = await storage.get(key);
  if (!object) throw new Error(`待合成片段不存在：${key}`);
  const buffer = await object.arrayBuffer();
  return { input: new Input({ formats: [MP4], source: new BufferSource(buffer) }) };
}

function multipartWritable(upload: R2MultipartUpload) {
  const parts: R2UploadedPart[] = [];
  let chunks: Uint8Array[] = [];
  let buffered = 0;
  let partNumber = 1;
  let settled = false;
  let resolveComplete!: (value: R2Object) => void;
  let rejectComplete!: (reason: unknown) => void;
  const completed = new Promise<R2Object>((resolve, reject) => {
    resolveComplete = resolve;
    rejectComplete = reject;
  });
  void completed.catch(() => undefined);

  const flush = async () => {
    if (!buffered) return;
    const bytes = new Uint8Array(buffered);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunks = [];
    buffered = 0;
    parts.push(await upload.uploadPart(partNumber++, bytes));
  };

  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      chunks.push(chunk.slice());
      buffered += chunk.byteLength;
      if (buffered >= MULTIPART_CHUNK_SIZE) await flush();
    },
    async close() {
      try {
        await flush();
        const object = await upload.complete(parts);
        settled = true;
        resolveComplete(object);
      } catch (error) {
        rejectComplete(error);
        throw error;
      }
    },
    async abort(reason) {
      try { await upload.abort(); } finally {
        settled = true;
        rejectComplete(reason instanceof Error ? reason : new Error("视频合成上传已中止"));
      }
    },
  });

  return {
    writable,
    completed,
    async abort() {
      if (!settled) {
        settled = true;
        try { await upload.abort(); } finally { rejectComplete(new Error("视频合成上传已中止")); }
      }
    },
  };
}
