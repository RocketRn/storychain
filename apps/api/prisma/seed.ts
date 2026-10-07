/* Seeds demo users (telegramId 1000001..1000004 = mock_user 1..4), featured + boosted chains and a few posts. */
import sharp from "sharp";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db";
import { createStorage } from "../src/storage";
import { publishPost } from "../src/services/posts";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const storage = createStorage(config);

const USERS = ["Anna", "Boris", "Clara", "Dmitri"];
const CHAINS = [
  { id: "cat00001", title: "Show your cat", emoji: "🐱" },
  { id: "desk0002", title: "Your desk right now", emoji: "🖥️" },
  { id: "trk00003", title: "Track of the day", emoji: "🎧" },
];
const HOUR = 3_600_000;
const now = Date.now();
/** Boost demos (all created by Anna = mock_user 1). Boost state is refreshed on every seed run. */
const BOOSTED = [
  {
    id: "hot00001",
    title: "Channel marathon: best shot of the week",
    emoji: "🔥",
    channelUrl: "https://t.me/storychain_demo",
    planId: "boost_7d",
    endsAt: new Date(now + 7 * 24 * HOUR),
  },
  {
    id: "hot00002",
    title: "Morning coffee ritual",
    emoji: "☕",
    channelUrl: null,
    planId: "boost_24h",
    endsAt: new Date(now + 24 * HOUR),
  },
  // boost already over: must NOT appear in the carousel and must not leak its channel link
  {
    id: "old00003",
    title: "Last week's challenge",
    emoji: "📅",
    channelUrl: "https://t.me/storychain_demo",
    planId: "boost_24h",
    endsAt: new Date(now - 24 * HOUR),
  },
] as const;
const COLORS = ["#ff9a62", "#2193b0", "#7b2ff7", "#ee4266", "#06d6a0"];

async function card(color: string, label: string): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="${color}"/><circle cx="540" cy="860" r="380" fill="rgba(255,255,255,0.25)"/><text x="540" y="900" font-size="120" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text></svg>`,
  );
  return sharp(svg).jpeg({ quality: 88 }).toBuffer();
}

const users = [];
for (const [i, name] of USERS.entries()) {
  const telegramId = BigInt(1_000_001 + i);
  users.push(
    await db.user.upsert({
      where: { telegramId },
      create: {
        telegramId,
        firstName: name,
        username: `demo_user_${1_000_001 + i}`,
        languageCode: i % 2 ? "en" : "ru",
      },
      update: {},
    }),
  );
}
const owner = users[0]!;

for (const c of CHAINS) {
  const chain = await db.chain.upsert({
    where: { id: c.id },
    create: { ...c, creatorId: owner.id, isFeatured: true },
    update: {},
  });
  for (const [i, u] of users.entries()) {
    const exists = await db.post.findUnique({
      where: { chainId_userId: { chainId: chain.id, userId: u.id } },
    });
    if (exists || i === 3) continue; // leave the last user un-joined so the "Join" flow can be tried
    await publishPost(
      { db, storage },
      {
        user: u,
        chain,
        image: await card(COLORS[(i + c.id.length) % COLORS.length]!, c.emoji),
        fields: { templateId: "sunset" },
      },
    );
  }
}

for (const b of BOOSTED) {
  const active = b.endsAt.getTime() > now;
  const boostData = { channelUrl: b.channelUrl, boostedUntil: b.endsAt, isBoosted: active };
  const chain = await db.chain.upsert({
    where: { id: b.id },
    create: { id: b.id, title: b.title, emoji: b.emoji, creatorId: owner.id, ...boostData },
    update: boostData,
  });
  const startsAt = new Date(b.endsAt.getTime() - (b.planId === "boost_7d" ? 7 * 24 : 24) * HOUR);
  await db.chainBoost.upsert({
    where: { txId: `seed_${b.id}` },
    create: {
      chainId: chain.id,
      userId: owner.id,
      planId: b.planId,
      startsAt,
      endsAt: b.endsAt,
      txId: `seed_${b.id}`,
    },
    update: { startsAt, endsAt: b.endsAt },
  });
  for (const [i, u] of users.entries()) {
    const exists = await db.post.findUnique({
      where: { chainId_userId: { chainId: chain.id, userId: u.id } },
    });
    if (exists || i >= 3) continue;
    await publishPost(
      { db, storage },
      {
        user: u,
        chain,
        image: await card(COLORS[(i + 2) % COLORS.length]!, b.emoji),
        fields: { templateId: "ocean" },
      },
    );
  }
}
console.log("Seeded.");
await db.$disconnect();
