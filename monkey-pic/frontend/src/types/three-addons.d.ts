declare module 'three/addons/loaders/TDSLoader.js' {
  import { Loader, Group } from 'three';
  export class TDSLoader extends Loader {
    constructor(manager?: any);
    parse(data: ArrayBuffer): Group;
    load(
      url: string,
      onLoad: (object: Group) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: any) => void
    ): void;
  }
}

declare module 'three/addons/exporters/STLExporter.js' {
  import { Object3D } from 'three';
  export class STLExporter {
    parse(object: Object3D, options?: { binary?: boolean }): string | ArrayBuffer;
  }
}

declare module 'three/addons/controls/OrbitControls.js' {
  import { Camera, Vector3 } from 'three';
  export class OrbitControls {
    constructor(object: Camera, domElement?: HTMLElement);
    dispose(): void;
    update(): void;
    enableDamping: boolean;
    dampingFactor: number;
    enablePan: boolean;
    target: Vector3;
  }
}

// Fallback minimal declaration for 'three' if types are missing
declare module 'three' {
  const Three: any;
  export = Three;
}
