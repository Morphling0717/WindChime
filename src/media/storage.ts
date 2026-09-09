export type WindChimeQrPosterConfig = {
  heading: string;
  body: string;
  footer: string;
  avatarSrc: string;
};
export const DEFAULT_POSTER_CONFIG: WindChimeQrPosterConfig = {
  heading: "",
  body: "",
  footer: "",
  avatarSrc: "",
};
export function readWindChimePosterConfig(
  storageKey: string,
  fallback: WindChimeQrPosterConfig,
  storage?: Pick<Storage, "getItem">,
): WindChimeQrPosterConfig {
  try {
    const parsed: unknown = JSON.parse(
      (storage ?? localStorage).getItem(storageKey) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object") return fallback;
    const value = { ...fallback };
    for (const key of Object.keys(DEFAULT_POSTER_CONFIG) as Array<
      keyof WindChimeQrPosterConfig
    >) {
      const field = (parsed as Record<string, unknown>)[key];
      if (typeof field === "string") value[key] = field;
    }
    return value;
  } catch {
    return fallback;
  }
}
export function writeWindChimePosterConfig(
  storageKey: string,
  value: WindChimeQrPosterConfig,
  storage?: Pick<Storage, "setItem">,
): boolean {
  try {
    (storage ?? localStorage).setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
