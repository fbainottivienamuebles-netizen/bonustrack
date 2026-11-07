-- CreateEnum
CREATE TYPE "SectionType" AS ENUM ('intro', 'verso', 'preestribillo', 'estribillo', 'puente', 'solo', 'outro');

-- CreateEnum
CREATE TYPE "TempoSource" AS ENUM ('manual', 'detectadoEnVivo');

-- CreateTable
CREATE TABLE "Song" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "artistaOriginal" TEXT NOT NULL,
    "duracionSegundos" INTEGER NOT NULL,
    "bpmManual" INTEGER,
    "fuenteTempo" "TempoSource" NOT NULL DEFAULT 'manual',
    "videoUrl" TEXT,
    "videoBpmReferencia" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "tipo" "SectionType" NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Line" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "tiempoInicioMs" INTEGER NOT NULL,

    CONSTRAINT "Line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setlist" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tanda" (
    "id" TEXT NOT NULL,
    "setlistId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Tanda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TandaSong" (
    "id" TEXT NOT NULL,
    "tandaId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "TandaSong_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Section_songId_orden_idx" ON "Section"("songId", "orden");

-- CreateIndex
CREATE INDEX "Line_sectionId_orden_idx" ON "Line"("sectionId", "orden");

-- CreateIndex
CREATE INDEX "Tanda_setlistId_orden_idx" ON "Tanda"("setlistId", "orden");

-- CreateIndex
CREATE INDEX "TandaSong_tandaId_orden_idx" ON "TandaSong"("tandaId", "orden");

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Line" ADD CONSTRAINT "Line_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tanda" ADD CONSTRAINT "Tanda_setlistId_fkey" FOREIGN KEY ("setlistId") REFERENCES "Setlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TandaSong" ADD CONSTRAINT "TandaSong_tandaId_fkey" FOREIGN KEY ("tandaId") REFERENCES "Tanda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TandaSong" ADD CONSTRAINT "TandaSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
