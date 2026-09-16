// ---------------------------------------------------------------------------
// Sensor looks for God's Eye View — Cesium post-process fragment shaders.
//
// Ported from bilawalsidhu/gods-eye-view (MIT, © 2026 Bilawal Sidhu):
// src/styles/{retro,surveillance,thermal,anime,noir,snow}.js. The GLSL is the
// original's, trimmed of its in-shader placeholder HUD bars (this app draws its
// HUD in the DOM) and tuned to the original's STYLE_PRESET_DEFAULTS.
//
// Every shader reads `intensity` (0-1) so a style change can cross-fade, and
// `time` (seconds) for grain, scanlines and snowfall.
// ---------------------------------------------------------------------------

export type StyleId = "normal" | "crt" | "nvg" | "flir" | "anime" | "noir" | "snow";

export interface SensorStyle {
  id: StyleId;
  label: string;
  /** Keyboard shortcut, 1-7. */
  key: string;
  blurb: string;
  fragmentShader?: string;
  /** Uniform defaults besides intensity/time. */
  uniforms?: Record<string, number>;
}

const NOISE = /* glsl */ `
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

const CRT = /* glsl */ `
  uniform sampler2D colorTexture;
  uniform vec2 colorTextureDimensions;
  uniform float intensity;
  uniform float pixelation;
  uniform float distortion;
  uniform float instability;
  uniform float time;
  in vec2 v_textureCoordinates;
  ${NOISE}

  float bayer8(vec2 pos) {
    ivec2 p = ivec2(mod(pos, 8.0));
    int index = p.x + p.y * 8;
    int bayer[64] = int[64](
       0, 32,  8, 40,  2, 34, 10, 42,
      48, 16, 56, 24, 50, 18, 58, 26,
      12, 44,  4, 36, 14, 46,  6, 38,
      60, 28, 52, 20, 62, 30, 54, 22,
       3, 35, 11, 43,  1, 33,  9, 41,
      51, 19, 59, 27, 49, 17, 57, 25,
      15, 47,  7, 39, 13, 45,  5, 37,
      63, 31, 55, 23, 61, 29, 53, 21
    );
    return float(bayer[index]) / 64.0;
  }

  vec2 barrelDistort(vec2 uv, float strength) {
    vec2 c = uv * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + r2 * strength * 0.4;
    return c * 0.5 + 0.5;
  }

  void main() {
    vec2 uv = v_textureCoordinates;
    vec2 dims = colorTextureDimensions;
    vec2 texel = 1.0 / dims;
    vec2 distUV = barrelDistort(uv, distortion * intensity);
    if (distUV.x < 0.0 || distUV.x > 1.0 || distUV.y < 0.0 || distUV.y > 1.0) {
      out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    float lineY = floor(distUV.y * dims.y);
    float jitterSeed = hash(vec2(lineY, floor(time * 8.0)));
    float jitterActive = step(0.97 - instability * 0.04, jitterSeed);
    float jitterAmount = (hash(vec2(lineY * 7.0, floor(time * 12.0))) - 0.5) *
                         0.008 * instability * jitterActive * intensity;
    vec2 jitteredUV = distUV + vec2(jitterAmount, 0.0);

    vec2 centered = jitteredUV - 0.5;
    float caStrength = length(centered) * 0.008 * intensity;
    float r = texture(colorTexture, jitteredUV + centered * caStrength).r;
    float g = texture(colorTexture, jitteredUV).g;
    float b = texture(colorTexture, jitteredUV - centered * caStrength).b;
    vec4 color = vec4(r, g, b, 1.0);

    float pixSize = mix(1.0, pixelation, intensity);
    vec2 pixelUV = floor(jitteredUV * dims / pixSize) * pixSize / dims;
    vec4 pixelColor = texture(colorTexture, mix(jitteredUV, pixelUV, intensity));
    color = mix(color, pixelColor, 0.7 * intensity);

    float dither = bayer8(jitteredUV * dims / pixSize) - 0.5;
    vec3 dithered = color.rgb + dither * 0.12 * intensity;
    float levels = mix(256.0, 10.0, intensity);
    vec3 posterized = floor(dithered * levels + 0.5) / levels;
    float gray = dot(posterized, vec3(0.299, 0.587, 0.114));
    vec3 result = mix(vec3(gray), posterized, 1.0 + 0.3 * intensity);

    float scanline = pow(sin(distUV.y * dims.y + time * 2.5) * 0.5 + 0.5, 1.5);
    float scanFade = 0.35 * intensity;
    result *= mix(1.0, scanline * scanFade + (1.0 - scanFade), intensity);

    vec3 ghost = texture(colorTexture, jitteredUV - vec2(texel.x * 2.0, 0.0)).rgb;
    result = mix(result, result + vec3(dot(ghost, vec3(0.299, 0.587, 0.114))) * 0.08, instability * intensity);

    result *= 1.0 - (sin(time * 188.5) * 0.5 + 0.5) * 0.03 * instability * intensity;

    float glitchSeed = hash(vec2(floor(time * 2.0), 0.0));
    if (step(0.92 - instability * 0.08, glitchSeed) > 0.0) {
      float glitchY = hash(vec2(floor(time * 2.0), 1.0));
      result += (1.0 - smoothstep(0.0, 0.003, abs(distUV.y - glitchY))) * 0.3 * instability * intensity;
    }

    result = mix(result, result * vec3(1.02, 1.0, 0.94), 0.4 * intensity);
    vec2 vigUV = distUV * (1.0 - distUV);
    float vig = clamp(pow(vigUV.x * vigUV.y * 20.0, 0.25 + 0.15 * intensity), 0.0, 1.0);
    result *= mix(1.0, vig, 0.6 * intensity);

    out_FragColor = vec4(mix(texture(colorTexture, uv).rgb, result, intensity), 1.0);
  }
`;

const NVG = /* glsl */ `
  uniform sampler2D colorTexture;
  uniform vec2 colorTextureDimensions;
  uniform float intensity;
  uniform float time;
  uniform float gain;
  uniform float bloom;
  uniform float scanlineStr;
  uniform float pixelation;
  in vec2 v_textureCoordinates;
  ${NOISE}

  vec2 barrelDistort(vec2 uv, float strength) {
    vec2 c = uv * 2.0 - 1.0;
    float r2 = dot(c, c);
    c *= 1.0 + r2 * strength * 0.5 + r2 * r2 * strength * 0.15;
    return c * 0.5 + 0.5;
  }

  float honeycomb(vec2 uv) {
    vec2 dims = colorTextureDimensions;
    vec2 p = uv * dims * min(dims.x, dims.y) * 0.008;
    vec2 r = vec2(1.0, 1.732);
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    float d = max(abs(gv.x), abs(gv.y * 0.577 + abs(gv.x) * 0.5));
    return smoothstep(0.4, 0.45, d);
  }

  void main() {
    vec2 uv = v_textureCoordinates;
    vec2 dims = colorTextureDimensions;
    vec2 texel = 1.0 / dims;
    vec2 distUV = barrelDistort(uv, 0.5 * intensity);

    vec2 centered = uv * 2.0 - 1.0;
    centered.x *= dims.x / dims.y;
    float radius = length(centered);
    float tubeMask = pow(1.0 - smoothstep(0.6, 1.05, radius), 0.7);
    float tubeShading = max(1.0 - radius * radius * 0.3, 0.0);
    if (tubeMask < 0.001 || distUV.x < 0.0 || distUV.x > 1.0 || distUV.y < 0.0 || distUV.y > 1.0) {
      out_FragColor = vec4(vec3(0.0), 1.0);
      return;
    }

    float pixSize = mix(1.0, pixelation, intensity);
    distUV = mix(distUV, floor(distUV * dims / pixSize) * pixSize / dims, intensity);
    vec4 original = texture(colorTexture, distUV);

    float luma = dot(original.rgb, vec3(0.299, 0.587, 0.114));
    float gainLevel = mix(0.8, 2.5, gain);
    float amplified = pow(clamp(luma * gainLevel, 0.0, 1.0), mix(1.2, 0.7, gain));

    float bloomAccum = 0.0;
    float bloomW = 0.0;
    for (int y = -5; y <= 5; y++) {
      for (int x = -5; x <= 5; x++) {
        vec2 offset = vec2(float(x), float(y)) * texel * 4.0;
        float sLuma = dot(texture(colorTexture, distUV + offset).rgb, vec3(0.299, 0.587, 0.114));
        float w = exp(-float(x * x + y * y) / 18.0);
        bloomAccum += smoothstep(0.4, 0.9, sLuma * gainLevel) * w;
        bloomW += w;
      }
    }
    bloomAccum /= bloomW;

    vec3 phosphor = vec3(0.16, 1.0, 0.22);
    vec3 nvgColor = phosphor * (amplified + bloomAccum * bloom * 1.5);

    float tubeGrain = (valueNoise(uv * 120.0 + vec2(time * 0.5, time * 0.3)) - 0.5) * mix(0.06, 0.2, gain) * intensity;
    nvgColor += phosphor * tubeGrain;
    float darkNoise = (1.0 - amplified) * hash(uv * dims + vec2(time * 200.0, time * 300.0));
    nvgColor += phosphor * darkNoise * 0.08 * gain * intensity;

    nvgColor *= 1.0 - honeycomb(distUV) * 0.04 * intensity;
    float scanline = pow(sin(distUV.y * dims.y * 1.2 + time * 2.0) * 0.5 + 0.5, 2.5);
    nvgColor *= 1.0 - scanline * scanlineStr * 0.15 * intensity;
    nvgColor *= tubeShading * tubeMask;

    nvgColor = clamp(nvgColor, 0.0, 1.0);
    out_FragColor = vec4(mix(original.rgb, nvgColor * tubeMask, intensity), 1.0);
  }
`;

const FLIR = /* glsl */ `
  uniform sampler2D colorTexture;
  uniform vec2 colorTextureDimensions;
  uniform float intensity;
  uniform float time;
  uniform float sensitivity;
  uniform float bloom;
  uniform float mode;
  uniform float pixelation;
  uniform float palette;
  in vec2 v_textureCoordinates;
  ${NOISE}

  vec3 ironbow(float t) {
    t = clamp(t, 0.0, 1.0);
    const vec3 c0 = vec3(0.0, 0.0, 0.0);
    const vec3 c1 = vec3(0.13, 0.0, 0.30);
    const vec3 c2 = vec3(0.49, 0.0, 0.45);
    const vec3 c3 = vec3(0.86, 0.10, 0.18);
    const vec3 c4 = vec3(1.0, 0.55, 0.0);
    const vec3 c5 = vec3(1.0, 0.91, 0.32);
    const vec3 c6 = vec3(1.0, 1.0, 1.0);
    float s = t * 6.0;
    if (s < 1.0) return mix(c0, c1, s);
    if (s < 2.0) return mix(c1, c2, s - 1.0);
    if (s < 3.0) return mix(c2, c3, s - 2.0);
    if (s < 4.0) return mix(c3, c4, s - 3.0);
    if (s < 5.0) return mix(c4, c5, s - 4.0);
    return mix(c5, c6, s - 5.0);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * valueNoise(p);
      p = p * 2.0 + vec2(100.0);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = v_textureCoordinates;
    vec2 dims = colorTextureDimensions;
    vec2 texel = 1.0 / dims;

    vec2 centered = uv * 2.0 - 1.0;
    centered.x *= dims.x / dims.y;
    float radius = length(centered);
    float lensMask = pow(1.0 - smoothstep(0.6, 1.05, radius), 0.7);
    float lensShading = max(1.0 - radius * radius * 0.25, 0.0);
    if (lensMask < 0.001) {
      out_FragColor = vec4(vec3(0.0), 1.0);
      return;
    }

    float pixSize = mix(1.0, pixelation, intensity);
    uv = mix(uv, floor(uv * dims / pixSize) * pixSize / dims, intensity);

    vec3 blurred = vec3(0.0);
    float totalWeight = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        float w = exp(-0.5 * float(x * x + y * y) / 2.0);
        blurred += texture(colorTexture, uv + vec2(float(x), float(y)) * texel * 1.5).rgb * w;
        totalWeight += w;
      }
    }
    blurred /= totalWeight;
    vec4 original = texture(colorTexture, uv);
    vec3 src = mix(original.rgb, blurred, 0.6 * intensity);

    float luma = dot(src, vec3(0.299, 0.587, 0.114));
    float sens = mix(0.25, 1.0, sensitivity);
    float temp = clamp((luma - (0.5 - sens * 0.5)) / sens, 0.0, 1.0);
    float contour = smoothstep(0.04, 0.06, abs(fract(temp * 12.0) - 0.5));
    temp *= mix(1.0, contour * 0.85 + 0.15, 0.3 * intensity);

    float isBlackHot = step(0.5, mode);
    float thermal = mix(temp, 1.0 - temp, isBlackHot);
    vec3 thermalColor = mix(vec3(thermal), ironbow(temp), palette);

    float bloomSample = 0.0;
    float bloomWeight = 0.0;
    for (int y = -4; y <= 4; y++) {
      for (int x = -4; x <= 4; x++) {
        vec2 offset = vec2(float(x), float(y)) * texel * 3.0;
        float sLuma = dot(texture(colorTexture, uv + offset).rgb, vec3(0.299, 0.587, 0.114));
        float sMapped = clamp((sLuma - (0.5 - sens * 0.5)) / sens, 0.0, 1.0);
        float sFinal = mix(sMapped, 1.0 - sMapped, isBlackHot);
        float w = exp(-0.5 * float(x * x + y * y) / 8.0);
        bloomSample += smoothstep(0.6, 1.0, sFinal) * w;
        bloomWeight += w;
      }
    }
    thermalColor += (bloomSample / bloomWeight) * bloom * 0.8;
    thermalColor += (fbm(uv * 80.0 + vec2(time * 0.3, time * 0.2)) - 0.5) * 0.08 * intensity;

    thermalColor = clamp(thermalColor * lensShading * lensMask, 0.0, 1.0);
    vec3 finalColor = mix(original.rgb, thermalColor, intensity);
    finalColor *= mix(1.0, lensMask, intensity);
    out_FragColor = vec4(finalColor, 1.0);
  }
`;

const ANIME = /* glsl */ `
  uniform sampler2D colorTexture;
  uniform vec2 colorTextureDimensions;
  uniform float intensity;
  uniform float saturation;
  uniform float edgeThick;
  in vec2 v_textureCoordinates;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = v_textureCoordinates;
    vec2 texel = 1.0 / colorTextureDimensions;
    vec4 color = texture(colorTexture, uv);

    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    float bands = mix(256.0, 4.0, intensity);
    float celLuma = floor(luma * bands + 0.5) / bands;
    vec3 celColor = color.rgb * ((luma > 0.001) ? celLuma / luma : 1.0);

    vec3 hsv = rgb2hsv(celColor);
    hsv.y = min(hsv.y * (1.0 + 0.6 * intensity * saturation), 1.0);
    hsv.z = min(hsv.z * (1.0 + 0.1 * intensity), 1.0);
    vec3 saturated = hsv2rgb(hsv);

    vec4 left  = texture(colorTexture, uv + vec2(-texel.x, 0.0));
    vec4 right = texture(colorTexture, uv + vec2( texel.x, 0.0));
    vec4 up    = texture(colorTexture, uv + vec2(0.0,  texel.y));
    vec4 down  = texture(colorTexture, uv + vec2(0.0, -texel.y));
    float edgeH = length(right.rgb - left.rgb);
    float edgeV = length(up.rgb - down.rgb);
    float edge = sqrt(edgeH * edgeH + edgeV * edgeV);
    float outline = 1.0 - smoothstep(0.05, mix(0.35, 0.1, edgeThick), edge) * 0.6 * intensity;

    vec3 result = saturated * vec3(1.02, 1.0, 0.95) * outline;
    out_FragColor = vec4(mix(color.rgb, result, intensity), color.a);
  }
`;

const NOIR = /* glsl */ `
  uniform sampler2D colorTexture;
  uniform vec2 colorTextureDimensions;
  uniform float intensity;
  uniform float contrastAmt;
  uniform float grainAmt;
  uniform float vignetteAmt;
  in vec2 v_textureCoordinates;

  void main() {
    vec2 uv = v_textureCoordinates;
    vec4 color = texture(colorTexture, uv);
    float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    vec3 desaturated = mix(color.rgb, vec3(luma), intensity);
    vec3 contrasted = clamp((desaturated - 0.5) * (1.0 + contrastAmt * intensity) + 0.5, 0.0, 1.0);

    float grain = fract(sin(dot(uv * colorTextureDimensions, vec2(12.9898, 78.233))) * 43758.5453);
    contrasted += (grain - 0.5) * 0.08 * grainAmt * intensity;

    vec2 vigUV = uv * (1.0 - uv);
    float vig = pow(vigUV.x * vigUV.y * 16.0, 0.3 + 0.4 * vignetteAmt * intensity);

    vec3 sepia = vec3(
      dot(contrasted, vec3(0.393, 0.769, 0.189)),
      dot(contrasted, vec3(0.349, 0.686, 0.168)),
      dot(contrasted, vec3(0.272, 0.534, 0.131))
    );
    vec3 result = mix(contrasted, sepia, 0.15 * intensity) * vig;
    out_FragColor = vec4(mix(color.rgb, result, intensity), color.a);
  }
`;

const SNOW = /* glsl */ `
  uniform sampler2D colorTexture;
  uniform vec2 colorTextureDimensions;
  uniform float intensity;
  uniform float time;
  uniform float density;
  uniform float wind;
  in vec2 v_textureCoordinates;

  float hash2(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float snowLayer(vec2 uv, float layer) {
    float depth = 0.5 + layer * 0.5;
    float speed = 0.4 + layer * 0.3;
    float size = mix(0.01, 0.025, layer);
    float windForce = sin(time * 0.5 + layer * 3.14) * (0.05 + wind * 0.2);
    vec2 snowUV = uv * vec2(1.0, 0.5) * (4.0 + layer * 4.0);
    snowUV.y += time * speed;
    snowUV.x += time * windForce;
    vec2 cell = floor(snowUV);
    vec2 f = fract(snowUV);
    float snow = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 point = vec2(hash2(cell + neighbor), hash2(cell + neighbor + 100.0));
        point = 0.5 + 0.4 * sin(time * 0.3 + 6.2831 * point);
        snow += smoothstep(size, 0.0, length(f - neighbor - point)) * depth;
      }
    }
    return snow;
  }

  void main() {
    vec2 uv = v_textureCoordinates;
    vec4 color = texture(colorTexture, uv);
    vec3 cool = color.rgb * vec3(0.85, 0.9, 1.1);
    float luma = dot(cool, vec3(0.299, 0.587, 0.114));
    vec3 desaturated = mix(cool, vec3(luma), 0.4 * intensity);
    vec3 brightened = mix(desaturated, vec3(1.0), 0.15 * intensity);
    vec3 frosted = mix(brightened, vec3(0.95, 0.97, 1.0), smoothstep(0.3, 0.8, luma) * 0.25 * intensity);

    float snow = snowLayer(uv, 0.0) * 0.5 + snowLayer(uv, 0.25) * 0.6 + snowLayer(uv, 0.5) * 0.7 +
                 snowLayer(uv, 0.75) * 0.8 + snowLayer(uv, 1.0);
    snow = clamp(snow * (0.4 + density * 1.2), 0.0, 1.0);

    vec3 result = frosted + snow * 0.8 * intensity;
    result = mix(result, vec3(0.85, 0.88, 0.95), smoothstep(0.0, 0.4, 1.0 - uv.y) * 0.1 * intensity);
    out_FragColor = vec4(mix(color.rgb, result, intensity), color.a);
  }
`;

export const STYLES: SensorStyle[] = [
  { id: "normal", label: "NORMAL", key: "1", blurb: "True-colour imagery" },
  {
    id: "crt",
    label: "CRT",
    key: "2",
    blurb: "Scanlines, dither, phosphor ghosting",
    fragmentShader: CRT,
    uniforms: { pixelation: 2.0, distortion: 0.15, instability: 0.42 },
  },
  {
    id: "nvg",
    label: "NVG",
    key: "3",
    blurb: "PVS-14 image intensifier",
    fragmentShader: NVG,
    uniforms: { gain: 0.35, bloom: 0.22, scanlineStr: 0.96, pixelation: 1.0 },
  },
  {
    id: "flir",
    label: "FLIR",
    key: "4",
    blurb: "Forward-looking infrared",
    fragmentShader: FLIR,
    uniforms: { sensitivity: 0.85, bloom: 0.2, mode: 0.0, pixelation: 1.0, palette: 1.0 },
  },
  {
    id: "anime",
    label: "ANIME",
    key: "5",
    blurb: "Cel-shaded outlines",
    fragmentShader: ANIME,
    uniforms: { saturation: 1.0, edgeThick: 0.5 },
  },
  {
    id: "noir",
    label: "NOIR",
    key: "6",
    blurb: "High-contrast film noir",
    fragmentShader: NOIR,
    uniforms: { contrastAmt: 1.2, grainAmt: 0.5, vignetteAmt: 0.5 },
  },
  {
    id: "snow",
    label: "SNOW",
    key: "7",
    blurb: "Winter overlay with snowfall",
    fragmentShader: SNOW,
    uniforms: { density: 0.6, wind: 0.5 },
  },
];

export const styleById = (id: StyleId) => STYLES.find((s) => s.id === id) ?? STYLES[0];
