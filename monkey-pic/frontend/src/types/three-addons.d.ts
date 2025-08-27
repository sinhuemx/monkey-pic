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

declare module 'three/addons/loaders/STLLoader.js' {
  import { Loader, BufferGeometry } from 'three';
  export class STLLoader extends Loader {
    constructor(manager?: any);
    load(
      url: string,
      onLoad: (geometry: BufferGeometry) => void,
      onProgress?: (event: ProgressEvent<EventTarget>) => void,
      onError?: (error: any) => void
    ): void;
    parse(data: ArrayBuffer | string): BufferGeometry;
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

declare module 'three/examples/jsm/controls/OrbitControls.js' {
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

declare module 'three/examples/jsm/loaders/OBJLoader.js' {
  import { Loader, Group } from 'three';
  export class OBJLoader extends Loader {
    constructor(manager?: any);
    load(
      url: string,
      onLoad: (group: Group) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: ErrorEvent) => void
    ): void;
    parse(data: string): Group;
  }
}

// Fallback minimal declaration for 'three' if types are missing
declare module 'three' {
  const Three: any;
  export = Three;
}
