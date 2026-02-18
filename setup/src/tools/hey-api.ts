type HeyApiResponse<D> =
  | { response: Response; data: D; error: undefined }
  | { response: Response; error: object; data: undefined };

export function extractRes<D>(obj: HeyApiResponse<D>): D {
  if (obj.error !== undefined) {
    throw new Error(`Error received from api ${JSON.stringify(obj.error, null, 2)}`);
  }

  return obj.data;
}
