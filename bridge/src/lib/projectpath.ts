import { existsSync } from "node:fs";

/**
 * Cursor の projects ディレクトリ名（例 "Users-admin-cursor-skill"）を
 * 実パス（例 "/Users/admin/cursor/skill"）へ復号する。
 *
 * ディレクトリ名は実パスの "/" を "-" に置換したものだが、フォルダ名自体が
 * "-" を含みうるため一意には戻せない。そこで先頭 "Users-<user>-" を
 * "/Users/<user>/" と固定し、残りのダッシュ列を左から貪欲に
 * 「候補パスが exists で実在するか」で分岐探索（バックトラック付き）する。
 *
 * - 深さ上限 MAX_DEPTH（/Users/<user> 以下のセグメント数）
 * - exists は注入可能（テストで実 FS に依存しないため）
 * - 失敗（形式不一致・実在しない・深さ超過）は null
 */

/** /Users/<user> 以下に許すパス深さ（探索の暴走防止）。 */
export const MAX_DEPTH = 8;

export type ExistsFn = (path: string) => boolean;

function search(
  base: string,
  tokens: string[],
  index: number,
  depth: number,
  exists: ExistsFn,
): string | null {
  if (index >= tokens.length) return base;
  if (depth >= MAX_DEPTH) return null;
  // 左から貪欲: まず最短セグメント（ダッシュ=区切り）を試し、実在しなければ
  // 次のトークンを取り込んでダッシュ含みフォルダ名として伸ばす。
  let segment = "";
  for (let j = index; j < tokens.length; j += 1) {
    segment = segment ? `${segment}-${tokens[j]}` : tokens[j];
    const candidate = `${base}/${segment}`;
    if (!exists(candidate)) continue;
    const resolved = search(candidate, tokens, j + 1, depth + 1, exists);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * ディレクトリ名 → 実パス。復号できないときは null。
 * exists を省略すると node:fs の existsSync を使う。
 */
export function decodeProjectDir(
  dirName: string,
  exists: ExistsFn = existsSync,
): string | null {
  if (typeof dirName !== "string") return null;
  const m = /^Users-([^-]+)-(.+)$/.exec(dirName);
  if (!m) return null;
  const root = `/Users/${m[1]}`;
  let rootExists = false;
  try {
    rootExists = exists(root);
  } catch {
    return null;
  }
  if (!rootExists) return null;
  try {
    return search(root, m[2].split("-"), 0, 0, exists);
  } catch {
    // 注入された exists が throw しても呼び出し側を巻き込まない
    return null;
  }
}

/** 復号結果の LRU 風キャッシュ（成功・失敗とも記憶、上限で全消し）。 */
const CACHE_MAX = 256;
const cache = new Map<string, string | null>();

/** 実 FS + キャッシュ付きの復号（アダプタの collect ループから呼ぶ用）。 */
export function decodeProjectDirCached(dirName: string): string | null {
  if (cache.has(dirName)) return cache.get(dirName) ?? null;
  const resolved = decodeProjectDir(dirName);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(dirName, resolved);
  return resolved;
}

/** テスト用: キャッシュを空にする。 */
export function clearProjectDirCache(): void {
  cache.clear();
}
