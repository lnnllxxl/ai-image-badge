const SIZE = 64;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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
  if (width !== SIZE || height !== SIZE) return 0;
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

export function analyzeRgbaPixels(data, width, height) {
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
  const periodicityScore = clamp01((residual.periodicity - 0.12) / 0.5);
  const blockScore = clamp01((residual.boundaryRatio - 1.25) / 2.25);
  const anomalyScore = clamp01(0.5 * spectralPeak + 0.35 * periodicityScore + 0.15 * blockScore);
  const reasons = [];
  if (spectralPeak >= 0.55) reasons.push("周波数分布に周期的なピークがあります");
  if (periodicityScore >= 0.55) reasons.push("微細ノイズに反復パターンがあります");
  if (blockScore >= 0.6) reasons.push("8ピクセル境界の差が目立ちます");
  return {
    anomalyScore,
    reasons,
    metrics: {
      spectralPeak,
      periodicity: residual.periodicity,
      blockRatio: residual.boundaryRatio,
      residualEnergy: residual.residualEnergy
    }
  };
}

export function analyzeBitmap(bitmap) {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, SIZE, SIZE);
  return analyzeRgbaPixels(context.getImageData(0, 0, SIZE, SIZE).data, SIZE, SIZE);
}
