/**
 * One-time migration script: assign classroomId to all active children
 * who don't yet have one, based on their dateOfBirth and the Rwanda ECD
 * 3-grade cycle.
 *
 * Grade assignment (Rwanda school-year convention):
 *   Grade 1 — age ≤ 3
 *   Grade 2 — age 4–5
 *   Grade 3 — age ≥ 6
 *
 * For each unassigned child the script:
 *   1. Computes the grade from DOB
 *   2. Looks up the matching classroom for the child's center
 *   3. Sets child.classroomId
 *   4. Creates a ClassroomAssignmentHistory record (reason: initial_enrollment)
 *
 * Idempotent: skips children who already have a classroomId.
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@host/db npx ts-node scripts/assign-classrooms.ts
 *
 * Add --dry-run to preview without writing.
 */

import { PrismaClient, ClassroomGrade, ClassroomAssignmentReason, ChildStatus } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function gradeFromDob(dateOfBirth: Date, referenceDate = new Date()): ClassroomGrade {
  let age = referenceDate.getFullYear() - dateOfBirth.getFullYear();
  const monthDiff = referenceDate.getMonth() - dateOfBirth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dateOfBirth.getDate())) {
    age--;
  }

  if (age <= 3) return ClassroomGrade.grade_1;
  if (age <= 5) return ClassroomGrade.grade_2;
  return ClassroomGrade.grade_3;
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  const unassigned = await prisma.child.findMany({
    where: {
      classroomId: null,
      deletedAt: null,
      status: ChildStatus.active,
    },
    select: { id: true, centerId: true, dateOfBirth: true },
  });

  console.log(`Found ${unassigned.length} active children without a classroom.`);
  if (unassigned.length === 0) return;

  // Pre-load all classrooms keyed by centerId+grade
  const classrooms = await prisma.classroom.findMany();
  const classroomMap = new Map<string, string>();
  for (const c of classrooms) {
    classroomMap.set(`${c.centerId}:${c.grade}`, c.id);
  }

  const now = new Date();
  let assigned = 0;
  let skipped = 0;

  // Process in batches of 200 to keep transactions manageable
  const BATCH = 200;
  for (let i = 0; i < unassigned.length; i += BATCH) {
    const batch = unassigned.slice(i, i + BATCH);

    if (!DRY_RUN) {
      await prisma.$transaction(async (tx) => {
        for (const child of batch) {
          const grade = gradeFromDob(child.dateOfBirth, now);
          const classroomId = classroomMap.get(`${child.centerId}:${grade}`);
          if (!classroomId) {
            console.warn(`  SKIP child ${child.id}: no ${grade} classroom for center ${child.centerId}`);
            skipped++;
            continue;
          }

          await tx.child.update({
            where: { id: child.id },
            data: { classroomId, updatedAt: now, version: { increment: 1 } },
          });

          await tx.classroomAssignmentHistory.create({
            data: {
              id: randomUUID(),
              childId: child.id,
              fromClassroomId: null,
              toClassroomId: classroomId,
              reason: ClassroomAssignmentReason.initial_enrollment,
              effectiveDate: now,
            },
          });

          assigned++;
        }
      });
    } else {
      for (const child of batch) {
        const grade = gradeFromDob(child.dateOfBirth, now);
        const classroomId = classroomMap.get(`${child.centerId}:${grade}`);
        if (!classroomId) {
          console.warn(`  SKIP child ${child.id}: no ${grade} classroom for center ${child.centerId}`);
          skipped++;
        } else {
          console.log(`  Would assign child ${child.id} → ${grade} (classroom ${classroomId})`);
          assigned++;
        }
      }
    }

    console.log(`  Processed ${Math.min(i + BATCH, unassigned.length)}/${unassigned.length}`);
  }

  console.log(`\nDone. Assigned: ${assigned}, Skipped: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
