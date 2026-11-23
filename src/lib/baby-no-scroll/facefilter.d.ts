// Types for the parts of jeeliz FaceFilter (npm "facefilter") this app uses.
// The package ships plain JavaScript; this is the contract its README documents.

declare module "facefilter/dist/jeelizFaceFilter.moduleES6.js" {
  export interface JeelizDetectState {
    detected: number;
    x: number;
    y: number;
    s: number;
    rx: number;
    ry: number;
    rz: number;
    expressions?: Float32Array | number[];
  }

  export interface JeelizSpec {
    GL: WebGLRenderingContext;
    canvasElement: HTMLCanvasElement;
    videoTexture: WebGLTexture;
    videoTransformMat2: Float32Array | number[];
    videoElement: HTMLVideoElement;
    maxFacesDetected: number;
  }

  export interface JeelizInit {
    canvasId?: string;
    canvas?: HTMLCanvasElement;
    NNC?: unknown;
    NNCPath?: string;
    maxFacesDetected?: number;
    followZRot?: boolean;
    animateDelay?: number;
    videoSettings?: Record<string, unknown>;
    stabilizationSettings?: Record<string, unknown>;
    callbackReady: (errCode: string | false | null, spec: JeelizSpec) => void;
    callbackTrack: (detectState: JeelizDetectState) => void;
  }

  export interface JeelizFaceFilter {
    init(opts: JeelizInit): boolean;
    destroy(): Promise<void>;
    resize(): boolean;
    toggle_pause(isPause: boolean, isShutOffVideo?: boolean): Promise<void>;
    create_new(): JeelizFaceFilter;
  }

  const JEELIZFACEFILTER: JeelizFaceFilter;
  export default JEELIZFACEFILTER;
}
