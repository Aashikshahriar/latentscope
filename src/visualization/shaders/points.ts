/**
 * Point-sprite shader shared by the 2D and 3D views.
 *
 * Attributes: position, color, aState (−1 hidden, 0 normal, 1 selected, 2 focus/hover),
 * aShape (marker index, used when shape encoding is on).
 * Shapes are drawn with signed-distance approximations inside gl_PointCoord, with a one-pixel
 * anti-aliased edge.
 */
export const pointsVertexShader = /* glsl */ `
attribute vec3 color;
attribute float aState;
attribute float aShape;
uniform float uSize;
uniform float uPixelRatio;
uniform float uDimOthers;
uniform float uPerspective;
uniform float uSizeBoost;
varying vec3 vColor;
varying float vState;
varying float vShape;
varying float vAlpha;
varying float vPixelSize;

void main() {
  vColor = color;
  vState = aState;
  vShape = aShape;
  if (aState < -0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vPixelSize = 0.0;
    return;
  }
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * uSizeBoost;
  if (aState > 1.5) size *= 2.0;
  else if (aState > 0.5) size *= 1.4;
  if (uPerspective > 0.5) size *= clamp(3.2 / max(-mv.z, 0.001), 0.35, 3.0);
  vPixelSize = max(size * uPixelRatio, 1.0);
  gl_PointSize = vPixelSize;
  vAlpha = (uDimOthers > 0.5 && aState < 0.5) ? 0.14 : 1.0;
}
`;

export const pointsFragmentShader = /* glsl */ `
uniform float uOpacity;
uniform float uShapes;
uniform float uOutline;
varying vec3 vColor;
varying float vState;
varying float vShape;
varying float vAlpha;
varying float vPixelSize;

float shapeDistance(vec2 p, float shape) {
  if (uShapes < 0.5 || shape < 0.5) return length(p);
  if (shape < 1.5) return max(abs(p.x), abs(p.y)) * 1.08;
  if (shape < 2.5) {
    vec2 q = vec2(p.x, -p.y + 0.12);
    return max(abs(q.x) * 0.866025 + q.y * 0.5, -q.y) * 1.75;
  }
  if (shape < 3.5) return (abs(p.x) + abs(p.y)) * 0.86;
  if (shape < 4.5) {
    float arm = 0.32;
    return min(max(abs(p.x), abs(p.y) / arm), max(abs(p.y), abs(p.x) / arm)) ;
  }
  return abs(length(p) - 0.66) * 2.9;
}

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = shapeDistance(p, vShape);
  float edge = 2.0 / vPixelSize;
  float alpha = 1.0 - smoothstep(1.0 - edge, 1.0, d);
  if (alpha <= 0.01) discard;
  vec3 col = vColor;
  if (uOutline > 0.5 && vState > 0.5) {
    float ring = smoothstep(0.58, 0.74, d);
    col = mix(col, vec3(1.0), ring * 0.9);
  }
  gl_FragColor = vec4(col, alpha * uOpacity * vAlpha);
}
`;
