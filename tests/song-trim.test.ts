import { beforeEach, describe, expect, test } from "vitest";

import type { PlayData } from "@/store/play-list";

import { useSongTrim } from "@/store/song-trim";

const mv: PlayData = { type: "mv", bvid: "BVx", cid: "11", title: "mv" };
const mvNoCid: PlayData = { type: "mv", bvid: "BVx", title: "mv" };
const audio: PlayData = { type: "audio", sid: 1, title: "audio" };

beforeEach(() => {
  useSongTrim.setState({ trims: {} });
});

describe("song-trim store", () => {
  test("default trim is zero", () => {
    expect(useSongTrim.getState().getTrim(mv)).toEqual({ start: 0, end: 0 });
    expect(useSongTrim.getState().getTrim(undefined)).toEqual({ start: 0, end: 0 });
  });

  test("setTrim and getTrim by mv key (bvid-cid)", () => {
    useSongTrim.getState().setTrim(mv, { start: 5, end: 10 });
    expect(useSongTrim.getState().getTrim(mv)).toEqual({ start: 5, end: 10 });
  });

  test("different songs have independent trims", () => {
    useSongTrim.getState().setTrim(mv, { start: 5, end: 10 });
    useSongTrim.getState().setTrim(audio, { start: 1, end: 2 });
    expect(useSongTrim.getState().getTrim(mv)).toEqual({ start: 5, end: 10 });
    expect(useSongTrim.getState().getTrim(audio)).toEqual({ start: 1, end: 2 });
  });

  test("setTrim clamps negative values to zero", () => {
    useSongTrim.getState().setTrim(mv, { start: -3, end: 20 });
    expect(useSongTrim.getState().getTrim(mv)).toEqual({ start: 0, end: 20 });
  });

  test("mv without cid stores bvid-level trim", () => {
    useSongTrim.getState().setTrim(mvNoCid, { start: 5, end: 0 });
    expect(useSongTrim.getState().getTrim(mvNoCid)).toEqual({ start: 5, end: 0 });
  });

  test("getTrim with cid falls back to bvid-level trim", () => {
    useSongTrim.getState().setTrim(mvNoCid, { start: 5, end: 3 });
    expect(useSongTrim.getState().getTrim(mv)).toEqual({ start: 5, end: 3 });
  });

  test("per-cid exact trim overrides bvid-level fallback", () => {
    useSongTrim.getState().setTrim(mvNoCid, { start: 5, end: 0 });
    useSongTrim.getState().setTrim(mv, { start: 1, end: 2 });
    expect(useSongTrim.getState().getTrim(mv)).toEqual({ start: 1, end: 2 });
    expect(useSongTrim.getState().getTrim(mvNoCid)).toEqual({ start: 5, end: 0 });
  });
});
