/* Seeds demo users (telegramId 1000001..1000004 = mock_user 1..4), featured chains and a few posts. */
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
// Demo posts must not eat the demo users' daily quota
await db.dailyUsage.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
console.log("Seeded.");
await db.$disconnect();
