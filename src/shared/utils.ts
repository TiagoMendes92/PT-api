import { Models } from "./enums";

export const encodeId = (type: Models, id: number | string): string => {
  return `${type}-${id}`;
};

export const decodeId = (type: Models, encodeId: string): string | null => {
  if (!encodeId) return null;
  return encodeId.replace(`${type}-`, "");
};
