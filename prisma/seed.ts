import { PrismaClient, Role, CameraStatus, AlertType } from "@prisma/client";
import { hash } from "bcryptjs";
import * as readline from "readline";

const prisma = new PrismaClient();

/**
 * Production safety guard — prevents accidental data wipe in production.
 * If NODE_ENV=production, requires explicit confirmation via --force flag.
 */
function checkProductionSafety(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const hasForceFlag = process.argv.includes("--force");

  if (isProduction && !hasForceFlag) {
    console.error(
      "\n  ERROR: Seed blocked — NODE_ENV is 'production'.\n" +
      "  The seed script DELETES ALL DATA before inserting demo records.\n" +
      "  If you really want to run this in production, use:\n\n" +
      "    npx tsx prisma/seed.ts --force\n"
    );
    process.exit(1);
  }

  if (isProduction && hasForceFlag) {
    console.warn(
      "\n  WARNING: Running seed in production with --force flag.\n" +
      "  All existing data will be deleted!\n"
    );
  }
}

async function main() {
  checkProductionSafety();

  console.log("Seeding database...\n");

  // ─── Clean existing data ─────────────────────────────
  await prisma.motionEvent.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.camera.deleteMany();
  await prisma.streamBridge.deleteMany();
  await prisma.user.deleteMany();
  await prisma.school.deleteMany();

  console.log("Cleared existing data");

  // ─── Create Schools ──────────────────────────────────
  const willowdale = await prisma.school.create({
    data: {
      name: "Willowdale Secondary School",
      slug: "willowdale",
      address: "123 Willowdale Ave, Toronto, ON",
      ipRange: "192.168.1.0/24",
      localStorageEnabled: true,
      cloudStorageEnabled: true,
      remoteAccessEnabled: true,
      localViewEnabled: true,
      retentionDays: 30,
      maxCameras: 16,
      maxUsers: 15,
    },
  });

  const riverside = await prisma.school.create({
    data: {
      name: "Riverside Elementary",
      slug: "riverside",
      address: "456 River Road, Mississauga, ON",
      ipRange: "10.0.0.0/24",
      localStorageEnabled: true,
      cloudStorageEnabled: false,
      remoteAccessEnabled: false,
      localViewEnabled: true,
      retentionDays: 14,
      maxCameras: 8,
      maxUsers: 5,
    },
  });

  const oakwood = await prisma.school.create({
    data: {
      name: "Oakwood Academy",
      slug: "oakwood",
      address: "789 Oak Street, Brampton, ON",
      ipRange: "172.16.0.0/16",
      localStorageEnabled: true,
      cloudStorageEnabled: true,
      remoteAccessEnabled: true,
      localViewEnabled: true,
      retentionDays: 60,
      maxCameras: 32,
      maxUsers: 20,
    },
  });

  console.log("✓ Created 3 schools");

  // ─── Create Users ────────────────────────────────────
  const passwordHash = await hash("password123", 12);

  const users = await Promise.all([
    // Super Admin (no school)
    prisma.user.create({
      data: {
        email: "admin@infosec.app",
        name: "System Administrator",
        password: passwordHash,
        role: Role.SUPER_ADMIN,
        schoolId: null,
      },
    }),
    // Ops Viewer (no school)
    prisma.user.create({
      data: {
        email: "ops@infosec.app",
        name: "Ops Viewer",
        password: passwordHash,
        role: Role.OPS_VIEWER,
        schoolId: null,
      },
    }),
    // Willowdale School Admin
    prisma.user.create({
      data: {
        email: "admin@willowdale.edu",
        name: "Sarah Chen",
        password: passwordHash,
        role: Role.SCHOOL_ADMIN,
        schoolId: willowdale.id,
      },
    }),
    // Willowdale School Viewer
    prisma.user.create({
      data: {
        email: "viewer@willowdale.edu",
        name: "James Wilson",
        password: passwordHash,
        role: Role.SCHOOL_VIEWER,
        schoolId: willowdale.id,
      },
    }),
    // Riverside School Admin
    prisma.user.create({
      data: {
        email: "admin@riverside.edu",
        name: "Maria Garcia",
        password: passwordHash,
        role: Role.SCHOOL_ADMIN,
        schoolId: riverside.id,
      },
    }),
    // Oakwood School Admin
    prisma.user.create({
      data: {
        email: "admin@oakwood.edu",
        name: "David Park",
        password: passwordHash,
        role: Role.SCHOOL_ADMIN,
        schoolId: oakwood.id,
      },
    }),
  ]);

  console.log("✓ Created 6 users (password: password123 for all)");

  // ─── Create Cameras for Willowdale ───────────────────
  const willowdaleCameras = await Promise.all([
    prisma.camera.create({
      data: {
        cameraId: "CAM-01",
        name: "Main Entrance",
        zone: "Entry",
        type: "Dome",
        resolution: "4K",
        rtspUrl: "rtsp://192.168.1.101:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-02",
        name: "Cafeteria",
        zone: "Indoor",
        type: "Wide",
        resolution: "1080p",
        rtspUrl: "rtsp://192.168.1.102:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-03",
        name: "North Corridor",
        zone: "Indoor",
        type: "Bullet",
        resolution: "1080p",
        rtspUrl: "rtsp://192.168.1.103:554/stream1",
        status: CameraStatus.WARNING,
        lastSeenAt: new Date(Date.now() - 60000),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-04",
        name: "Parking Lot A",
        zone: "Outdoor",
        type: "PTZ",
        resolution: "4K",
        rtspUrl: "rtsp://192.168.1.104:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-05",
        name: "Gym / Sports Hall",
        zone: "Indoor",
        type: "Wide",
        resolution: "1080p",
        rtspUrl: "rtsp://192.168.1.105:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-06",
        name: "Library",
        zone: "Indoor",
        type: "Dome",
        resolution: "1080p",
        rtspUrl: "rtsp://192.168.1.106:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-07",
        name: "Rear Exit",
        zone: "Entry",
        type: "Bullet",
        resolution: "1080p",
        rtspUrl: "rtsp://192.168.1.107:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-08",
        name: "Admin Office",
        zone: "Indoor",
        type: "Dome",
        resolution: "720p",
        rtspUrl: "rtsp://192.168.1.108:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-09",
        name: "Science Lab",
        zone: "Indoor",
        type: "Wide",
        resolution: "1080p",
        rtspUrl: "rtsp://192.168.1.109:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-10",
        name: "Playground",
        zone: "Outdoor",
        type: "PTZ",
        resolution: "4K",
        rtspUrl: "rtsp://192.168.1.110:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-11",
        name: "Rooftop",
        zone: "Outdoor",
        type: "Bullet",
        resolution: "1080p",
        rtspUrl: "rtsp://192.168.1.111:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-12",
        name: "Stairwell A",
        zone: "Indoor",
        type: "Bullet",
        resolution: "720p",
        rtspUrl: "rtsp://192.168.1.112:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-13",
        name: "Stairwell B",
        zone: "Indoor",
        type: "Bullet",
        resolution: "720p",
        rtspUrl: "rtsp://192.168.1.113:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-14",
        name: "Loading Dock",
        zone: "Outdoor",
        type: "Bullet",
        resolution: "1080p",
        rtspUrl: "rtsp://192.168.1.114:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: willowdale.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-15",
        name: "Boiler Room",
        zone: "Indoor",
        type: "Dome",
        resolution: "720p",
        rtspUrl: "rtsp://192.168.1.115:554/stream1",
        status: CameraStatus.OFFLINE,
        lastSeenAt: new Date(Date.now() - 300000),
        schoolId: willowdale.id,
      },
    }),
  ]);

  console.log("✓ Created 15 cameras for Willowdale");

  // ─── Create Cameras for Riverside ────────────────────
  await Promise.all([
    prisma.camera.create({
      data: {
        cameraId: "CAM-01",
        name: "Front Door",
        zone: "Entry",
        type: "Dome",
        resolution: "1080p",
        rtspUrl: "rtsp://10.0.0.101:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: riverside.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-02",
        name: "Hallway A",
        zone: "Indoor",
        type: "Bullet",
        resolution: "1080p",
        rtspUrl: "rtsp://10.0.0.102:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: riverside.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-03",
        name: "Playground",
        zone: "Outdoor",
        type: "PTZ",
        resolution: "1080p",
        rtspUrl: "rtsp://10.0.0.103:554/stream1",
        status: CameraStatus.ONLINE,
        lastSeenAt: new Date(),
        schoolId: riverside.id,
      },
    }),
    prisma.camera.create({
      data: {
        cameraId: "CAM-04",
        name: "Parking Lot",
        zone: "Outdoor",
        type: "Bullet",
        resolution: "720p",
        rtspUrl: "rtsp://10.0.0.104:554/stream1",
        status: CameraStatus.OFFLINE,
        lastSeenAt: new Date(Date.now() - 600000),
        schoolId: riverside.id,
      },
    }),
  ]);

  console.log("✓ Created 4 cameras for Riverside");

  // ─── Create Alerts for Willowdale ────────────────────
  const now = new Date();
  await Promise.all([
    prisma.alert.create({
      data: {
        type: AlertType.CRITICAL,
        title: "Camera offline",
        detail: "CAM-15 (Boiler Room) has been offline for 5 minutes",
        cameraId: willowdaleCameras[14].id,
        schoolId: willowdale.id,
        resolved: false,
        createdAt: new Date(now.getTime() - 120000),
      },
    }),
    prisma.alert.create({
      data: {
        type: AlertType.WARNING,
        title: "Camera quality drop",
        detail: "CAM-15 (Boiler Room) image quality degraded below threshold",
        cameraId: willowdaleCameras[14].id,
        schoolId: willowdale.id,
        resolved: false,
        createdAt: new Date(now.getTime() - 540000),
      },
    }),
    prisma.alert.create({
      data: {
        type: AlertType.CRITICAL,
        title: "Motion alert triggered",
        detail: "Unusual motion detected in North Corridor after hours",
        cameraId: willowdaleCameras[2].id,
        schoolId: willowdale.id,
        resolved: false,
        createdAt: new Date(now.getTime() - 180000),
      },
    }),
    prisma.alert.create({
      data: {
        type: AlertType.WARNING,
        title: "Loitering flag",
        detail: "Person detected lingering in Parking Lot A for >10 minutes",
        cameraId: willowdaleCameras[3].id,
        schoolId: willowdale.id,
        resolved: false,
        createdAt: new Date(now.getTime() - 420000),
      },
    }),
    prisma.alert.create({
      data: {
        type: AlertType.INFO,
        title: "Recording restored",
        detail: "Rooftop camera recording has been restored",
        cameraId: willowdaleCameras[10].id,
        schoolId: willowdale.id,
        resolved: true,
        createdAt: new Date(now.getTime() - 660000),
      },
    }),
    prisma.alert.create({
      data: {
        type: AlertType.INFO,
        title: "Backup completed",
        detail: "NVR-01 daily backup completed successfully",
        cameraId: null,
        schoolId: willowdale.id,
        resolved: true,
        createdAt: new Date(now.getTime() - 900000),
      },
    }),
  ]);

  console.log("✓ Created 6 alerts for Willowdale (3 active, 2 critical)");

  // ─── Create Motion Events for Willowdale ─────────────
  // Create motion events for the last hour with varying counts
  const motionData = [
    { camera: willowdaleCameras[0], count: 82 },  // Entrance - high traffic
    { camera: willowdaleCameras[3], count: 67 },  // Parking A - moderate
    { camera: willowdaleCameras[2], count: 55 },  // North Corridor
    { camera: willowdaleCameras[1], count: 30 },  // Cafeteria
    { camera: willowdaleCameras[4], count: 18 },  // Gym
    { camera: willowdaleCameras[5], count: 12 },  // Library
    { camera: willowdaleCameras[6], count: 8 },   // Rear Exit
    { camera: willowdaleCameras[7], count: 5 },   // Admin Office
  ];

  for (const { camera, count } of motionData) {
    // Spread motion events across the last hour
    const eventsToCreate = Math.min(count, 20); // Create up to 20 event records
    const countPerEvent = Math.ceil(count / eventsToCreate);

    for (let i = 0; i < eventsToCreate; i++) {
      await prisma.motionEvent.create({
        data: {
          cameraId: camera.id,
          schoolId: willowdale.id,
          count: countPerEvent,
          recordedAt: new Date(
            now.getTime() - Math.random() * 60 * 60 * 1000
          ),
        },
      });
    }
  }

  console.log("✓ Created motion events for Willowdale (last 60 minutes)");

  // ─── Create Stream Bridges ───────────────────────────
  await prisma.streamBridge.create({
    data: {
      schoolId: willowdale.id,
      internalUrl: "http://192.168.1.100:8889",
      publicUrl: "https://stream.willowdale.infosec.app",
      apiKey: await hash("willowdale-agent-secret-key", 12),
      lastPingAt: new Date(),
      online: true,
    },
  });

  await prisma.streamBridge.create({
    data: {
      schoolId: riverside.id,
      internalUrl: "http://10.0.0.100:8889",
      publicUrl: null,
      apiKey: await hash("riverside-agent-secret-key", 12),
      lastPingAt: new Date(Date.now() - 120000),
      online: true,
    },
  });

  await prisma.streamBridge.create({
    data: {
      schoolId: oakwood.id,
      internalUrl: "http://172.16.0.100:8889",
      publicUrl: "https://stream.oakwood.infosec.app",
      apiKey: await hash("oakwood-agent-secret-key", 12),
      lastPingAt: null,
      online: false,
    },
  });

  console.log("✓ Created 3 stream bridges");

  // ─── Summary ─────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════");
  console.log("  🎉 Seed complete!");
  console.log("═══════════════════════════════════════════");
  console.log("\n  Test accounts (all use password: password123):\n");
  console.log("  SUPER_ADMIN:   admin@infosec.app");
  console.log("  OPS_VIEWER:    ops@infosec.app");
  console.log("  SCHOOL_ADMIN:  admin@willowdale.edu (Willowdale)");
  console.log("  SCHOOL_VIEWER: viewer@willowdale.edu (Willowdale)");
  console.log("  SCHOOL_ADMIN:  admin@riverside.edu (Riverside)");
  console.log("  SCHOOL_ADMIN:  admin@oakwood.edu (Oakwood)");
  console.log("\n═══════════════════════════════════════════\n");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Seed error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
