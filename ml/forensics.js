import "../i18n.js";
const t = (key, fallback, substitutions) => globalThis.AiImageBadgeI18n?.t(key, fallback, substitutions) || fallback;
const FAST_SIZE = 64;
const STANDARD_SIZE = 128;
const DETAILED_SIZE = 256;

const STANDARD_REGIONS = [
  [0.5, 0.5],
  [0.2, 0.2],
  [0.8, 0.2],
  [0.2, 0.8],
  [0.8, 0.8]
];

const DETAILED_REGIONS = [
  [0.16, 0.16], [0.5, 0.16], [0.84, 0.16],
  [0.16, 0.5], [0.5, 0.5], [0.84, 0.5],
  [0.16, 0.84], [0.5, 0.84], [0.84, 0.84]
];

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function inspectJpegCompression(input, mimeType = "") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  const declaredJpeg = /^image\/jpe?g(?:;|$)/i.test(String(mimeType));
  const hasSignature = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!declaredJpeg && !hasSignature) {
    return { isJpeg: false, tableCount: 0, quantizationMean: 0, compressionStrength: 0 };
  }

  const quantizers = [];
  let offset = hasSignature ? 2 : 0;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    const segmentEnd = offset + segmentLength;
    offset += 2;
    if (marker === 0xdb) {
      while (offset < segmentEnd) {
        const precision = bytes[offset] >> 4;
        offset += 1;
        const bytesPerValue = precision === 0 ? 1 : 2;
        if (offset + 64 * bytesPerValue > segmentEnd) break;
        for (let index = 0; index < 64; index += 1) {
          if (bytesPerValue === 1) {
            quantizers.push(bytes[offset]);
            offset += 1;
          } else {
            quantizers.push((bytes[offset] << 8) | bytes[offset + 1]);
            offset += 2;
          }
        }
      }
    }
    offset = segmentEnd;
  }

  const quantizationMean = mean(quantizers);
  // 高い量子化値ほど8pxブロック境界と周期ノイズがJPEG圧縮由来である可能性が高い。
  const compressionStrength = quantizers.length
    ? clamp01((quantizationMean - 8) / 48)
    : 0.25;
  return {
    isJpeg: true,
    tableCount: Math.floor(quantizers.length / 64),
    quantizationMean,
    compressionStrength
  };
}

function fft(real, imaginary) {
  const length = real.length;
  for (let i = 1, j = 0; i < length; i += 1) {
    let bit = length >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let block = 2; block <= length; block <<= 1) {
    const angle = -2 * Math.PI / block;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < length; start += block) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < block / 2; offset += 1) {
        const even = start + offset;
        const odd = even + block / 2;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

function spectralPeakScore(luminance, width, height) {
  if (width !== height || (width & (width - 1)) !== 0) return 0;
  const real = new Float64Array(width * height);
  const imaginary = new Float64Array(width * height);
  let mean = 0;
  for (const value of luminance) mean += value;
  mean /= luminance.length;
  for (let y = 0; y < height; y += 1) {
    const windowY = 0.5 - 0.5 * Math.cos((2 * Math.PI * y) / (height - 1));
    for (let x = 0; x < width; x += 1) {
      const windowX = 0.5 - 0.5 * Math.cos((2 * Math.PI * x) / (width - 1));
      real[y * width + x] = (luminance[y * width + x] - mean) * windowX * windowY;
    }
  }

  const rowReal = new Float64Array(width);
  const rowImaginary = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rowReal[x] = real[y * width + x];
    rowImaginary.fill(0);
    fft(rowReal, rowImaginary);
    for (let x = 0; x < width; x += 1) {
      real[y * width + x] = rowReal[x];
      imaginary[y * width + x] = rowImaginary[x];
    }
  }

  const columnReal = new Float64Array(height);
  const columnImaginary = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      columnReal[y] = real[y * width + x];
      columnImaginary[y] = imaginary[y * width + x];
    }
    fft(columnReal, columnImaginary);
    for (let y = 0; y < height; y += 1) {
      real[y * width + x] = columnReal[y];
      imaginary[y * width + x] = columnImaginary[y];
    }
  }

  const powers = [];
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(y, height - y) / height;
    for (let x = 0; x < width; x += 1) {
      const fx = Math.min(x, width - x) / width;
      const radius = Math.hypot(fx, fy);
      if (radius < 0.16 || radius > 0.48) continue;
      const index = y * width + x;
      powers.push(real[index] ** 2 + imaginary[index] ** 2 + 1e-9);
    }
  }
  const middle = median(powers);
  const peak = Math.max(...powers);
  const logRatio = Math.log(Math.max(1, peak / Math.max(middle, 1e-9)));
  return clamp01((logRatio - Math.log(30)) / (Math.log(2500) - Math.log(30)));
}

function residualFeatures(luminance, width, height) {
  const residual = new Float64Array(width * height);
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
    periodicity = Math.max(periodicity, Math.abs(covariance / Math.max(1, pairs)) / Math.max(variance, 1e-9));
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

function reasonsFromMetrics(metrics) {
  const reasons = [];
  if (metrics.spectralPeak >= 0.55) reasons.push(t("spectralPeak", "周波数分布に周期的なピークがあります"));
  if (metrics.periodicityScore >= 0.55) reasons.push(t("repeatedNoise", "微細ノイズに反復パターンがあります"));
  if (metrics.blockScore >= 0.6) reasons.push(t("pixelBoundaries", "8ピクセル境界の差が目立ちます"));
  return reasons;
}

export function analyzeRgbaPixels(data, width, height, options = {}) {
  if (!data || width < 16 || height < 16 || data.length < width * height * 4) {
    return { anomalyScore: 0, reasons: [], metrics: {}, skipped: "too-small" };
  }
  const luminance = new Float64Array(width * height);
  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    luminance[index] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
  }
  const residual = residualFeatures(luminance, width, height);
  const spectralPeak = spectralPeakScore(luminance, width, height);
  const jpegStrength = clamp01(Number(options.jpegCompressionStrength) || 0);
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
  return {
    anomalyScore,
    reasons: reasonsFromMetrics(metrics),
    metrics
  };
}

function analyzeBitmapRegion(bitmap, sampleSize, centerX, centerY, cropRatio, jpegInfo) {
  const canvas = new OffscreenCanvas(sampleSize, sampleSize);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const sourceSize = Math.max(16, Math.min(bitmap.width, bitmap.height) * cropRatio);
  const sourceX = Math.min(bitmap.width - sourceSize, Math.max(0, bitmap.width * centerX - sourceSize / 2));
  const sourceY = Math.min(bitmap.height - sourceSize, Math.max(0, bitmap.height * centerY - sourceSize / 2));
  context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, sampleSize, sampleSize);
  return analyzeRgbaPixels(
    context.getImageData(0, 0, sampleSize, sampleSize).data,
    sampleSize,
    sampleSize,
    { jpegCompressionStrength: jpegInfo?.compressionStrength || 0 }
  );
}

function aggregateEnhanced(base, regions, profile, sampleSize, jpegInfo) {
  const topCount = Math.max(1, Math.ceil(regions.length / 2));
  const strongest = [...regions].sort((a, b) => b.anomalyScore - a.anomalyScore).slice(0, topCount);
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
    jpegCompressionStrength: jpegInfo?.compressionStrength || 0,
    jpegQuantizationMean: jpegInfo?.quantizationMean || 0,
    regionCount: regions.length,
    sampleSize
  };
  const anomalyScore = clamp01(0.25 * base.anomalyScore + 0.75 * mean(strongest.map((entry) => entry.anomalyScore)));
  return {
    anomalyScore,
    reasons: reasonsFromMetrics(metrics),
    metrics,
    analysisProfile: profile,
    enhanced: true
  };
}

export function analyzeBitmap(bitmap, options = {}) {
  const profile = ["standard", "detailed"].includes(options.profile) ? options.profile : "fast";
  const jpegInfo = options.jpegInfo || { isJpeg: false, quantizationMean: 0, compressionStrength: 0 };
  const base = analyzeBitmapRegion(bitmap, FAST_SIZE, 0.5, 0.5, 1, jpegInfo);
  if (profile === "fast") {
    return {
      ...base,
      metrics: {
        ...base.metrics,
        jpegQuantizationMean: jpegInfo.quantizationMean || 0,
        regionCount: 1,
        sampleSize: FAST_SIZE
      },
      analysisProfile: "fast",
      enhanced: false
    };
  }

  const definitions = profile === "detailed" ? DETAILED_REGIONS : STANDARD_REGIONS;
  const sampleSize = profile === "detailed" ? DETAILED_SIZE : STANDARD_SIZE;
  const cropRatio = profile === "detailed" ? 0.34 : 0.46;
  const regions = definitions.map(([centerX, centerY]) =>
    analyzeBitmapRegion(bitmap, sampleSize, centerX, centerY, cropRatio, jpegInfo));
  return aggregateEnhanced(base, regions, profile, sampleSize, jpegInfo);
}
