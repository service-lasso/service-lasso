export interface ISizeCalculationResult {
  width: number;
  height: number;
  type?: string;
  orientation?: number;
  images?: ISizeCalculationResult[];
}
export declare const types: readonly string[];
export declare function disableTypes(types: string[]): void;
export declare function imageSize(input: Uint8Array): ISizeCalculationResult;
export default imageSize;
