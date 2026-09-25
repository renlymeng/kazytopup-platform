import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (>= 12 chars)');
  await prisma.adminUser.upsert({
    where: { email }, update: {},
    create: { email, role: 'SUPER_ADMIN', passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
  });
  console.log(`Super admin ready: ${email} (you will be forced to enrol MFA at first login)`);
}
main().finally(() => prisma.$disconnect());
