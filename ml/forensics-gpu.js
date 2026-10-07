import "../i18n.js";
import { analyzeRgbaPixels } from "./forensics.js";

const t = (key, fallback) => globalThis.AiImageBadgeI18n?.t(key, fallback) || fallback;
const SIZE = 256;
const WORKGROUP_SIZE = 128;
const REGIONS = [
  [0.16, 0.16], [0.5, 0.16], [0.84, 0.16],
  [0.16, 0.5], [0.5, 0.5], [0.84, 0.5],
  [0.16, 0.84], [0.5, 0.84], [0.84, 0.84]
];

const FFT_SHADER = /* wgsl */ `
struct Params {
  size: u32,
  regions: u32,
  axis: u32,
  padding: u32,
};

@group(0) @binding(0) var<storage, read_write> values: array<vec2<f32>>;
@group(0) @binding(1) var<uniform> params: Params;
var<workgroup> scratch: array<vec2<f32>, 256>;

fn reverseBits(inputValue: u32, size: u32) -> u32 {
  var input = inputValue;
  var span = size;
  var result = 0u;
  loop {
    if (span <= 1u) { break; }
    result = (result << 1u) | (input & 1u);
    input = input >> 1u;
    span = span >> 1u;
  }
  return result;
}

fn storageIndex(transform: u32, element: u32) -> u32 {
  let region = transform / params.size;
  let line = transform % params.size;
  let regionOffset = region * params.size * params.size;
  if (params.axis == 0u) {
    return regionOffset + line * params.size + element;
  }
  return regionOffset + element * params.size + line;
}

@compute @workgroup_size(128)
fn main(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>
) {
  let transform = workgroupId.x;
  if (transform >= params.size * params.regions || params.size != 256u) { return; }

  let lane = localId.x;
  let second = lane + 128u;
  scratch[reverseBits(lane, params.size)] = values[storageIndex(transform, lane)];
  scratch[reverseBits(second, params.size)] = values[storageIndex(transform, second)];
  workgroupBarrier();

  var stage = 2u;
  loop {
    if (stage > params.size) { break; }
    let half = stage / 2u;
    let group = lane / half;
    let offset = lane % half;
    let evenIndex = group * stage + offset;
    let oddIndex = evenIndex + half;
    let angle = -6.283185307179586 * f32(offset) / f32(stage);
    let twiddle = vec2<f32>(cos(angle), sin(angle));
    let oddValue = scratch[oddIndex];
    let rotated = vec2<f32>(
      oddValue.x * twiddle.x - oddValue.y * twiddle.y,
      oddValue.x * twiddle.y + oddValue.y * twiddle.x
    );
    let evenValue = scratch[evenIndex];
    scratch[evenIndex] = evenValue + rotated;
    scratch[oddIndex] = evenValue - rotated;
    workgroupBarrier();
    stage = stage * 2u;
  }

  values[storageIndex(transform, lane)] = scratch[lane];
  values[storageIndex(transform, second)] = scratch[second];
}
`;

let runtimePromise = null;
let runtimeDevice = null;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function createRuntime() {
  if (!globalThis.navigator?.gpu) {
    throw codedError("webgpu-unavailable", "WebGPU is unavailable");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw codedError("webgpu-adapter-unavailable", "WebGPU adapter is unavailable");
  const device = await adapter.requestDevice();
  if (device.limits.maxComputeInvocationsPerWorkgroup < WORKGROUP_SIZE) {
    device.destroy();
    throw codedError("webgpu-limit", "WebGPU workgroup limit is too small");
  }
  const module = device.createShaderModule({ code: FFT_SHADER, label: "AI IMAGE BADGE detailed FFT" });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((message) => message.type === "error");
  if (errors.length) {
    device.destroy();
    throw codedError("webgpu-shader", errors.map((message) => message.message).join("; "));
  }
  const pipeline = await device.createComputePipelineAsync({
    label: "AI IMAGE BADGE detailed FFT pipeline",
    layout: "auto",
    compute: { module, entryPoint: "main" }
  });
  runtimeDevice = device;
  device.lost.then(() => {
    if (runtimeDevice === device) {
      runtimeDevice = null;
      runtimePromise = null;
    }
  });
  return { device, pipeline };
}

async function getRuntime() {
  if (!runtimePromise) runtimePromise = createRuntime();
  try {
    return await runtimePromise;
  } catch (error) {
    runtimePromise = null;
    throw error;
  }
}

function median(values) {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function mean(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function residualFeatures(luminance, width, height) {
  const residual = new Float32Array(width * height);
  let variance = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = luminance[index] - (
        luminance[index - 1] + luminance[index + 1] +
        luminance[index - width] + luminance[index + width]
      ) / 4;
      residual[index] = value;
      variance += value * value;
      count += 1;
    }
  }
  variance /= Math.max(1, count);

  let periodicity = 0;
  for (const lag of [2, 4, 8]) {
    let covariance = 0;
    let pairs = 0;
    for (let y = 1; y < height - 1 - lag; y += 1) {
      for (let x = 1; x < width - 1 - lag; x += 1) {
        const index = y * width + x;
        covariance += residual[index] * residual[index + lag];
        covariance += residual[index] * residual[index + lag * width];
        pairs += 2;
      }
    }
    periodicity = Math.max(
      periodicity,
      Math.abs(covariance / Math.max(1, pairs)) / Math.max(variance, 1e-9)
    );
  }

  let boundary = 0;
  let ordinary = 0;
  let boundaryCount = 0;
  let ordinaryCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const difference = Math.abs(luminance[y * width + x] - luminance[y * width + x - 1]);
      if (x % 8 === 0) { boundary += difference; boundaryCount += 1; }
      else { ordinary += difference; ordinaryCount += 1; }
    }
  }
  for (let y = 1; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const difference = Math.abs(luminance[y * width + x] - luminance[(y - 1) * width + x]);
      if (y % 8 === 0) { boundary += difference; boundaryCount += 1; }
      else { ordinary += difference; ordinaryCount += 1; }
    }
  }
  const boundaryRatio = (boundary / Math.max(1, boundaryCount)) /
    Math.max(1e-9, ordinary / Math.max(1, ordinaryCount));
  return { periodicity, boundaryRatio, residualEnergy: Math.sqrt(variance) };
}

function spectralPeakFromComplex(complex, regionIndex) {
  const powers = [];
  const regionOffset = regionIndex * SIZE * SIZE;
  let peak = 0;
  for (let y = 0; y < SIZE; y += 1) {
    const fy = Math.min(y, SIZE - y) / SIZE;
    for (let x = 0; x < SIZE; x += 1) {
      const fx = Math.min(x, SIZE - x) / SIZE;
      const radius = Math.hypot(fx, fy);
      if (radius < 0.16 || radius > 0.48) continue;
      const offset = (regionOffset + y * SIZE + x) * 2;
      const power = complex[offset] ** 2 + complex[offset + 1] ** 2 + 1e-9;
      powers.push(power);
      peak = Math.max(peak, power);
    }
  }
  const middle = median(powers);
  const logRatio = Math.log(Math.max(1, peak / Math.max(middle, 1e-9)));
  return clamp01((logRatio - Math.log(30)) / (Math.log(2500) - Math.log(30)));
}

function reasonsFromMetrics(metrics) {
  const reasons = [];
  if (metrics.spectralPeak >= 0.55) reasons.push(t("spectralPeak", "周波数分布に周期的なピークがあります"));
  if (metrics.periodicityScore >= 0.55) reasons.push(t("repeatedNoise", "微細ノイズに反復パターンがあります"));
  if (metrics.blockScore >= 0.6) reasons.push(t("pixelBoundaries", "8ピクセル境界の差が目立ちます"));
  return reasons;
}

function scoreRegion(luminance, complex, regionIndex, jpegStrength) {
  const residual = residualFeatures(luminance, SIZE, SIZE);
  const spectralPeak = spectralPeakFromComplex(complex, regionIndex);
  const rawPeriodicityScore = clamp01((residual.periodicity - 0.12) / 0.5);
  const rawBlockScore = clamp01((residual.boundaryRatio - 1.25) / 2.25);
  const periodicityScore = rawPeriodicityScore * (1 - 0.3 * jpegStrength);
  const blockScore = rawBlockScore * (1 - 0.75 * jpegStrength);
  const anomalyScore = clamp01(0.5 * spectralPeak + 0.35 * periodicityScore + 0.15 * blockScore);
  const metrics = {
    spectralPeak,
    periodicity: residual.periodicity,
    periodicityScore,
    blockRatio: residual.boundaryRatio,
    blockScore,
    rawPeriodicityScore,
    rawBlockScore,
    residualEnergy: residual.residualEnergy,
    jpegCompressionStrength: jpegStrength
  };
  return { anomalyScore, metrics, reasons: reasonsFromMetrics(metrics) };
}

function imageDataToLuminance(imageData) {
  const luminance = new Float32Array(SIZE * SIZE);
  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    luminance[index] = (
      0.2126 * imageData.data[offset] +
      0.7152 * imageData.data[offset + 1] +
      0.0722 * imageData.data[offset + 2]
    ) / 255;
  }
  return luminance;
}

function prepareRegions(bitmap) {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const sourceSize = Math.max(16, Math.min(bitmap.width, bitmap.height) * 0.34);
  const luminanceRegions = [];
  const complex = new Float32Array(REGIONS.length * SIZE * SIZE * 2);

  for (let regionIndex = 0; regionIndex < REGIONS.length; regionIndex += 1) {
    const [centerX, centerY] = REGIONS[regionIndex];
    const sourceX = Math.min(bitmap.width - sourceSize, Math.max(0, bitmap.width * centerX - sourceSize / 2));
    const sourceY = Math.min(bitmap.height - sourceSize, Math.max(0, bitmap.height * centerY - sourceSize / 2));
    context.clearRect(0, 0, SIZE, SIZE);
    context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, SIZE, SIZE);
    const luminance = imageDataToLuminance(context.getImageData(0, 0, SIZE, SIZE));
    luminanceRegions.push(luminance);
    let average = 0;
    for (const value of luminance) average += value;
    average /= luminance.length;
    const regionOffset = regionIndex * SIZE * SIZE;
    for (let y = 0; y < SIZE; y += 1) {
      const windowY = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (SIZE - 1));
      for (let x = 0; x < SIZE; x += 1) {
        const windowX = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (SIZE - 1));
        const index = y * SIZE + x;
        complex[(regionOffset + index) * 2] = (luminance[index] - average) * windowX * windowY;
      }
    }
  }
  return { luminanceRegions, complex };
}

function analyzeBase(bitmap, jpegStrength) {
  const canvas = new OffscreenCanvas(64, 64);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 64, 64);
  return analyzeRgbaPixels(
    context.getImageData(0, 0, 64, 64).data,
    64,
    64,
    { jpegCompressionStrength: jpegStrength }
  );
}

async function runGpuFft(input) {
  const { device, pipeline } = await getRuntime();
  const usage = globalThis.GPUBufferUsage;
  const mapMode = globalThis.GPUMapMode;
  if (!usage || !mapMode) throw codedError("webgpu-api-unavailable", "WebGPU buffer APIs are unavailable");

  const storage = device.createBuffer({
    label: "AI IMAGE BADGE detailed FFT values",
    size: input.byteLength,
    usage: usage.STORAGE | usage.COPY_SRC,
    mappedAtCreation: true
  });
  new Float32Array(storage.getMappedRange()).set(input);
  storage.unmap();
  const readback = device.createBuffer({
    label: "AI IMAGE BADGE detailed FFT readback",
    size: input.byteLength,
    usage: usage.COPY_DST | usage.MAP_READ
  });
  const rowParams = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
  const columnParams = device.createBuffer({ size: 16, usage: usage.UNIFORM | usage.COPY_DST });
  device.queue.writeBuffer(rowParams, 0, new Uint32Array([SIZE, REGIONS.length, 0, 0]));
  device.queue.writeBuffer(columnParams, 0, new Uint32Array([SIZE, REGIONS.length, 1, 0]));

  try {
    const encoder = device.createCommandEncoder({ label: "AI IMAGE BADGE detailed FFT commands" });
    for (const params of [rowParams, columnParams]) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: storage } },
          { binding: 1, resource: { buffer: params } }
        ]
      }));
      pass.dispatchWorkgroups(SIZE * REGIONS.length);
      pass.end();
    }
    encoder.copyBufferToBuffer(storage, 0, readback, 0, input.byteLength);
    device.queue.submit([encoder.finish()]);
    await readback.mapAsync(mapMode.READ);
    return new Float32Array(readback.getMappedRange()).slice();
  } finally {
    if (readback.mapState === "mapped") readback.unmap();
    storage.destroy();
    readback.destroy();
    rowParams.destroy();
    columnParams.destroy();
  }
}

export async function analyzeBitmapGpu(bitmap, options = {}) {
  if (!bitmap || bitmap.width < 96 || bitmap.height < 96) {
    throw codedError("image-too-small", "Image is too small for detailed GPU analysis");
  }
  const jpegInfo = options.jpegInfo || {};
  const jpegStrength = clamp01(Number(jpegInfo.compressionStrength) || 0);
  const base = analyzeBase(bitmap, jpegStrength);
  const { luminanceRegions, complex } = prepareRegions(bitmap);
  const transformed = await runGpuFft(complex);
  const regions = luminanceRegions.map((luminance, index) =>
    scoreRegion(luminance, transformed, index, jpegStrength));
  const strongest = [...regions]
    .sort((a, b) => b.anomalyScore - a.anomalyScore)
    .slice(0, Math.ceil(regions.length / 2));
  const metric = (name) => 0.25 * (Number(base.metrics[name]) || 0) +
    0.75 * mean(strongest.map((entry) => Number(entry.metrics[name]) || 0));
  const metrics = {
    spectralPeak: metric("spectralPeak"),
    periodicity: metric("periodicity"),
    periodicityScore: metric("periodicityScore"),
    blockRatio: metric("blockRatio"),
    blockScore: metric("blockScore"),
    rawPeriodicityScore: metric("rawPeriodicityScore"),
    rawBlockScore: metric("rawBlockScore"),
    residualEnergy: metric("residualEnergy"),
    jpegCompressionStrength: jpegStrength,
    jpegQuantizationMean: Number(jpegInfo.quantizationMean) || 0,
    regionCount: regions.length,
    sampleSize: SIZE
  };
  const anomalyScore = clamp01(
    0.25 * base.anomalyScore + 0.75 * mean(strongest.map((entry) => entry.anomalyScore))
  );
  return {
    anomalyScore,
    reasons: reasonsFromMetrics(metrics),
    metrics,
    analysisProfile: "detailed",
    enhanced: true,
    backend: "webgpu",
    gpuFallback: false
  };
}

