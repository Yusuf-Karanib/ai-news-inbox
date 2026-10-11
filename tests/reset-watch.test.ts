import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyResetPost,
  formatResetWatchMessage,
  newestUnseenResetPost,
  type ResetWatchPost,
} from "../supabase/functions/_shared/reset_watch_logic.ts";
import {
  actionableResetPost,
  parseVerifiedTiboPost,
  tiboStatusReference,
} from "../supabase/functions/_shared/tibo_post_fetcher.ts";

test("clear global reset announcements and confirmations are separated", () => {
  assert.equal(
    classifyResetPost(
      "Global reset by EOD. May the tokens do good things for you.",
    ),
    "global_announced",
  );
  assert.equal(
    classifyResetPost("Put the reset in the bag. All propagated."),
    "global_completed",
  );
});

test("banked reset announcements and arrivals are separated", () => {
  assert.equal(
    classifyResetPost("Loading a banked reset in everyone's paid accounts."),
    "banked_announced",
  );
  assert.equal(
    classifyResetPost(
      "Confirmed landed across all accounts.",
      "Loading a banked reset in everyone's paid accounts.",
    ),
    "banked_completed",
  );
});

test("reset jokes and polls do not create an urgent alert", () => {
  assert.equal(
    classifyResetPost("Four updates or a reset. Or both. How was day 2."),
    null,
  );
  assert.equal(
    classifyResetPost("I can't really give a reset. I need something new."),
    null,
  );
  assert.equal(
    classifyResetPost("Here is what I will build when my limits reset."),
    null,
  );
  assert.equal(classifyResetPost("Day 6/ Reset"), "possible");
});

test("Codex Radar is only used to find an exact Tibo status reference", () => {
  const item = {
    externalKey: "2109045392684032299",
    title: "Codex usage reset",
    summary:
      'Original post: <a href="https://x.com/thsottiaux/status/2109045392684032299">X</a>',
    url: "https://codexradar.com/events/2109045392684032299",
    publishedAt: "2026-10-10T22:16:20.000Z",
  };
  const reference = tiboStatusReference(item);
  assert.ok(reference);
  assert.equal(reference.postId, "2109045392684032299");
  assert.equal(
    tiboStatusReference({
      ...item,
      summary: "https://x.com/someone-else/status/2109045392684032299",
    }),
    null,
  );
});

test("a discovered link must match the exact public Tibo post response", () => {
  const expected = {
    postId: "2109045392684032299",
    postUrl: "https://x.com/thsottiaux/status/2109045392684032299",
    publishedAt: "2026-10-10T22:16:20.000Z",
  };
  const payload = {
    tweet: {
      id: expected.postId,
      url: expected.postUrl,
      text: "Global reset by EOD. May the tokens do good things for you.",
      created_timestamp: 1_791_670_580,
      author: { screen_name: "thsottiaux" },
    },
  };
  const verified = parseVerifiedTiboPost(payload, expected);
  assert.ok(verified);
  assert.equal(verified.kind, "global_announced");
  assert.equal(actionableResetPost(verified)?.postId, expected.postId);
  assert.equal(
    parseVerifiedTiboPost({
      tweet: { ...payload.tweet, author: { screen_name: "someone_else" } },
    }, expected),
    null,
  );
  assert.equal(
    parseVerifiedTiboPost({
      tweet: { ...payload.tweet, id: "2109045392684032200" },
    }, expected),
    null,
  );
});

test("a completion can be understood from Tibo's quoted reset post", () => {
  const expected = {
    postId: "2109132167112782291",
    postUrl: "https://x.com/thsottiaux/status/2109132167112782291",
    publishedAt: "2026-10-11T04:01:09.000Z",
  };
  const verified = parseVerifiedTiboPost({
    tweet: {
      id: expected.postId,
      url: expected.postUrl,
      text: "Put the reset in the bag. All propagated.",
      created_timestamp: 1_791_691_269,
      author: { screen_name: "thsottiaux" },
      quote: {
        text: "Global reset by EOD.",
        author: { screen_name: "thsottiaux" },
      },
    },
  }, expected);
  assert.equal(verified?.kind, "global_completed");
});

test("only the newest unseen reset state is selected", () => {
  const older: ResetWatchPost = {
    postId: "2109045392684032299",
    postUrl: "https://x.com/thsottiaux/status/2109045392684032299",
    text: "Global reset by EOD.",
    publishedAt: "2026-10-10T22:16:20.000Z",
    kind: "global_announced",
  };
  const newer: ResetWatchPost = {
    postId: "2109132167112782291",
    postUrl: "https://x.com/thsottiaux/status/2109132167112782291",
    text: "Put the reset in the bag. All propagated.",
    publishedAt: "2026-10-11T04:01:09.000Z",
    kind: "global_completed",
  };
  const result = newestUnseenResetPost(
    [older, newer],
    new Set<string>(),
  );
  assert.equal(result.selected?.postId, newer.postId);
  assert.deepEqual(result.ignored.map((post) => post.postId), [older.postId]);
});

test("the alert clearly protects a banked reset", () => {
  const message = formatResetWatchMessage({
    postId: "2109045392684032299",
    postUrl: "https://x.com/thsottiaux/status/2109045392684032299",
    text: "Global reset by EOD.",
    publishedAt: "2026-10-10T22:16:20.000Z",
    kind: "global_announced",
  });
  assert.match(message, /Do not spend a banked reset yet/);
  assert.match(message, /check your Usage page/i);
  assert.match(message, /Source: https:\/\/x\.com\/thsottiaux\/status\//);
  assert.match(message, /Codex Radar/);
});
