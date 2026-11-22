// ---------------------------------------------------------------------------
// The avatar's body shader.
//
// Vertex: every vertex of a unit sphere is pushed to the radius of TWO forms
// (formRadius in lib/new-jarvis/avatar/looks.ts — this is a line-for-line port,
// change both together) and blended, so a wolf melts into a robot rather than
// swapping. Normals are rebuilt from the displaced neighbours. A transformation
// "pulse" adds a travelling noise ripple while it melts — the moment that
// makes the change feel like energy rather than a crossfade.
//
// Fragment: six materials (holo, glass, metal, plasma, matte, wire) blended by
// weight, so the material morphs with the shape.
// ---------------------------------------------------------------------------

const NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

const FORMS = /* glsl */ `
float bump(vec3 d, vec3 c, float k){ return exp(-k*(1.0-dot(d, normalize(c)))); }
float ellipsoid(vec3 d, float a, float b, float c){ return 1.0/sqrt((d.x/a)*(d.x/a)+(d.y/b)*(d.y/b)+(d.z/c)*(d.z/c)); }
float superEll(vec3 d, float a, float b, float c, float p){
  return pow(pow(abs(d.x/a),p)+pow(abs(d.y/b),p)+pow(abs(d.z/c),p), -1.0/p);
}
float formR(float f, vec3 d){
  if (f < 0.5) { float a = 0.8 - 0.12*max(0.0,-d.y); return ellipsoid(d,a,1.0,0.86) + 0.06*bump(d,vec3(0.0,-0.05,1.0),60.0); }
  if (f < 1.5) { return superEll(d,0.86,0.92,0.8,6.0) + 0.32*bump(d,vec3(0.0,1.0,0.0),400.0); }
  if (f < 2.5) { return ellipsoid(d,0.8,0.85,0.85) + 0.55*bump(d,vec3(0.0,-0.25,0.97),10.0) + 0.55*bump(d,vec3(-0.5,0.85,0.1),40.0) + 0.55*bump(d,vec3(0.5,0.85,0.1),40.0); }
  if (f < 3.5) { return ellipsoid(d,0.86,0.82,0.8) + 0.4*bump(d,vec3(-0.6,0.78,0.15),45.0) + 0.4*bump(d,vec3(0.6,0.78,0.15),45.0) + 0.15*bump(d,vec3(0.0,-0.3,0.95),14.0); }
  if (f < 4.5) { return ellipsoid(d,0.78,0.85,0.95) + 0.7*bump(d,vec3(0.0,-0.15,0.99),8.0) + 0.75*bump(d,vec3(-0.45,0.8,-0.4),60.0) + 0.75*bump(d,vec3(0.45,0.8,-0.4),60.0); }
  if (f < 5.5) { float a = 0.5 + 0.42*smoothstep(-1.0,0.6,d.y); return ellipsoid(d,a,1.05,a); }
  if (f < 6.5) { return 0.9 + 0.035*snoise(d*3.0 + uTime*0.6); }
  if (f < 7.5) { vec3 q = vec3(abs(d.x), abs(d.y)/1.3, abs(d.z)); float m = max(max(q.x,q.y), max(q.z,(q.x+q.y+q.z)/1.7320508/0.82)); return 0.82/m; }
  return 0.85 + 0.1*snoise(d*2.2 + uTime*0.35) + 0.04*snoise(d*5.0 - uTime*0.5);
}
`;

export const BODY_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uFormA;
uniform float uFormB;
uniform float uMix;
uniform float uPulse;
uniform float uBreath;
uniform float uListen;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vDir;
varying float vRipple;
${NOISE}
${FORMS}
float radiusAt(vec3 d){
  float r = mix(formR(uFormA,d), formR(uFormB,d), uMix);
  // The transformation surge: a wave of noise that rides over the body while it melts.
  float ripple = snoise(d*3.5 + vec3(0.0, uTime*2.2, 0.0));
  r += uPulse * 0.11 * ripple;
  // Breathing, and pulling inward slightly while it listens.
  r *= 1.0 + uBreath*0.012 - uListen*0.015;
  return r;
}
void main(){
  vec3 d = normalize(position);
  vec3 t1 = normalize(cross(d, abs(d.y) > 0.98 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0)));
  vec3 t2 = cross(d, t1);
  float e = 0.012;
  vec3 d1 = normalize(d + t1*e);
  vec3 d2 = normalize(d + t2*e);
  vec3 p0 = d*radiusAt(d);
  vec3 p1 = d1*radiusAt(d1);
  vec3 p2 = d2*radiusAt(d2);
  vec3 n = normalize(cross(p1-p0, p2-p0));
  if (dot(n,d) < 0.0) n = -n;
  vRipple = uPulse * snoise(d*3.5 + vec3(0.0, uTime*2.2, 0.0));
  vDir = d;
  vec4 world = modelMatrix * vec4(p0, 1.0);
  vPosW = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const BODY_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform float uGlow;
uniform float uPulse;
uniform vec3 uMatA; // holo, glass, metal
uniform vec3 uMatB; // plasma, matte, wire
uniform float uWarmth;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vDir;
varying float vRipple;
${NOISE}
void main(){
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vPosW);
  float ndv = clamp(dot(N,V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  float band = vDir.y + 0.18*sin(vDir.x*3.0 + uTime*0.7);
  vec3 grad = mix(uSecondary, uPrimary, smoothstep(-0.9, 0.8, band));
  grad = mix(grad, grad*vec3(1.25,0.95,0.8), clamp(uWarmth,0.0,1.0)*0.5);
  grad = mix(grad, grad*vec3(0.8,0.95,1.2), clamp(-uWarmth,0.0,1.0)*0.5);
  vec3 L = normalize(vec3(-0.4, 0.8, 0.6));
  float lam = clamp(dot(N,L), 0.0, 1.0);
  vec3 H = normalize(L+V);
  float spec = pow(clamp(dot(N,H),0.0,1.0), 48.0);

  // holo — scanlines, rim light, see-through
  float scan = 0.5 + 0.5*sin(vPosW.y*90.0 - uTime*5.0);
  vec3 holo = grad*(0.28 + lam*0.25) + grad*fres*1.8*uGlow + grad*scan*0.12;
  float holoA = 0.5 + fres*0.5;

  // glass — mostly rim and highlight
  vec3 glass = grad*0.12 + grad*fres*1.5*uGlow + vec3(spec)*1.2;
  float glassA = 0.28 + fres*0.65 + spec*0.4;

  // metal — a fake studio environment reflected
  vec3 R = reflect(-V, N);
  float env = smoothstep(-0.25, 0.7, R.y) + 0.35*sin(R.x*6.0 + R.y*3.0);
  vec3 metal = grad*(0.15 + env*0.95) + vec3(spec)*1.6 + grad*fres*0.6*uGlow;

  // plasma — flowing energy
  float n = snoise(vDir*2.6 + vec3(0.0, uTime*0.55, uTime*0.2));
  float n2 = snoise(vDir*6.0 - uTime*0.8);
  vec3 plasma = mix(uSecondary, uPrimary, n*0.5+0.5)*(0.7 + 0.6*abs(n2)) + grad*fres*1.4*uGlow;
  float plasmaA = 0.92;

  // matte — lit solid
  vec3 matte = grad*(0.22 + lam*0.85) + grad*fres*0.5*uGlow + vec3(spec)*0.15;

  // wire — latitude/longitude lines
  float lat = abs(fract(acos(clamp(vDir.y,-1.0,1.0))*9.0/3.14159) - 0.5);
  float lon = abs(fract((atan(vDir.z, vDir.x)/6.28318 + 0.5)*24.0 + uTime*0.05) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.06, min(lat, lon));
  vec3 wire = grad*line*2.2 + grad*fres*0.8*uGlow;
  float wireA = clamp(line*0.95 + fres*0.45, 0.0, 1.0);

  float wsum = uMatA.x+uMatA.y+uMatA.z+uMatB.x+uMatB.y+uMatB.z + 1e-4;
  vec3 col = (holo*uMatA.x + glass*uMatA.y + metal*uMatA.z + plasma*uMatB.x + matte*uMatB.y + wire*uMatB.z)/wsum;
  float alpha = (holoA*uMatA.x + glassA*uMatA.y + 1.0*uMatA.z + plasmaA*uMatB.x + 1.0*uMatB.y + wireA*uMatB.z)/wsum;

  // The surge lights the crest of the wave as it passes.
  col += mix(uPrimary, vec3(1.0), 0.5) * max(vRipple, 0.0) * 1.6;
  col += grad * uPulse * 0.25;
  gl_FragColor = vec4(col, clamp(alpha + uPulse*0.2, 0.0, 1.0));
}
`;

/** The mouth: a lip line drawn on a small plane — smile, open, wide, round. */
export const MOUTH_VERTEX = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

export const MOUTH_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uSmile;
uniform float uOpen;
uniform float uGlow;
varying vec2 vUv;
void main(){
  vec2 p = vUv*2.0 - 1.0; // -1..1
  float x = p.x;
  float edge = 1.0 - x*x;
  if (edge <= 0.0) discard;
  float centre = uSmile*0.38*(x*x) - uSmile*0.16;
  float half_ = uOpen*0.55*sqrt(edge) + 0.035;
  float top = centre + half_;
  float bot = centre - half_;
  float inside = step(bot, p.y) * step(p.y, top);
  float d = min(abs(p.y-top), abs(p.y-bot));
  float lip = 1.0 - smoothstep(0.0, 0.09, d);
  vec3 col = mix(vec3(0.01,0.03,0.06), uColor*1.6*uGlow, lip);
  float a = max(lip, inside*0.92) * smoothstep(0.0, 0.08, edge);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

/** Floating motes around the body; they blow outward when it transforms. */
export const MOTES_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPulse;
uniform float uSpin;
uniform float uSize;
attribute float aSeed;
varying float vFade;
void main(){
  float a = aSeed*6.2831 + uTime*(0.15 + aSeed*0.25)*uSpin;
  vec3 p = position;
  float c = cos(a), s = sin(a);
  p.xz = mat2(c,-s,s,c)*p.xz;
  p *= 1.0 + uPulse*0.55*aSeed;
  p.y += sin(uTime*0.8 + aSeed*20.0)*0.08;
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  gl_PointSize = uSize*(0.6 + aSeed)*(1.0 + uPulse)*(3.0/ -mv.z);
  vFade = 0.35 + 0.65*fract(aSeed*7.13 + uTime*0.2);
  gl_Position = projectionMatrix*mv;
}
`;

export const MOTES_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vFade;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vFade;
  gl_FragColor = vec4(uColor, a);
}
`;
