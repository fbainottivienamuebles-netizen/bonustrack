-- Fase 3a (metrónomo) y fase 4 (video de fondo).

-- CreateEnum
CREATE TYPE "ClickSound" AS ENUM ('madera', 'cencerro', 'beep');

-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "compas" TEXT NOT NULL DEFAULT '4/4',
ADD COLUMN     "compasesCuenta" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "referenciaUrl" TEXT,
ADD COLUMN     "sonidoClic" "ClickSound" NOT NULL DEFAULT 'madera';

-- Hasta ahora "videoUrl" guardaba un video de referencia (YouTube, etc.).
-- Desde esta versión es el video de fondo de la Pantalla: lo que había pasa a
-- "referenciaUrl".
UPDATE "Song" SET "referenciaUrl" = "videoUrl", "videoUrl" = NULL WHERE "videoUrl" IS NOT NULL;
