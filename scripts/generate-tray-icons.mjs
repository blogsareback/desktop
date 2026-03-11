/**
 * Generates tray icon PNGs from the BAB logo SVG.
 *
 * Outputs:
 *   assets/tray/iconTemplate.png      – monochrome 22px  (macOS @1x template)
 *   assets/tray/iconTemplate@2x.png   – monochrome 44px  (macOS @2x template)
 *   assets/tray/iconColor.png          – colored    22px  (macOS @1x)
 *   assets/tray/iconColor@2x.png       – colored    44px  (macOS @2x)
 *   assets/tray/icon.png               – colored    32px  (Windows/Linux)
 *   assets/tray/icon@2x.png            – colored    64px  (Windows/Linux HiDPI)
 */

import sharp from 'sharp'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SVG_PATH = path.join(ROOT, 'assets', 'icon.svg')
const OUT_DIR = path.join(ROOT, 'assets', 'tray')

const svgOriginal = fs.readFileSync(SVG_PATH, 'utf8')

const MONO_SVG_PATH = path.join(ROOT, 'assets', 'icon-mono.svg')
const svgMono = fs.readFileSync(MONO_SVG_PATH, 'utf8')

fs.mkdirSync(OUT_DIR, { recursive: true })

// Render SVG to a PNG of the given size, optionally with padding baked in.
// When padding > 0, the content is rendered at (size - 2*padding) and centered
// in a size×size transparent canvas.
async function renderSvg(svgString, size, outputPath, padding = 0) {
  const contentSize = size - padding * 2
  const buf = Buffer.from(svgString)
  const rendered = await sharp(buf, { density: Math.round((72 * contentSize) / 390) * 4 })
    .resize(contentSize, contentSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  if (padding > 0) {
    await sharp(rendered)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(outputPath)
  } else {
    await sharp(rendered).toFile(outputPath)
  }

  console.log(`  ${path.relative(ROOT, outputPath)} (${size}x${size}, content ${contentSize}x${contentSize})`)
}

async function main() {
  console.log('Generating tray icons...\n')

  // macOS: 22pt / 44px @2x — ~2pt padding to match native menu bar icon sizing
  const MAC_PAD_1X = 2
  const MAC_PAD_2X = 4

  // macOS template (monochrome)
  await renderSvg(svgMono, 22, path.join(OUT_DIR, 'iconTemplate.png'), MAC_PAD_1X)
  await renderSvg(svgMono, 44, path.join(OUT_DIR, 'iconTemplate@2x.png'), MAC_PAD_2X)

  // macOS colored
  await renderSvg(svgOriginal, 22, path.join(OUT_DIR, 'iconColor.png'), MAC_PAD_1X)
  await renderSvg(svgOriginal, 44, path.join(OUT_DIR, 'iconColor@2x.png'), MAC_PAD_2X)

  // Windows/Linux: no padding — icons fill their 16/32px allocation
  await renderSvg(svgOriginal, 32, path.join(OUT_DIR, 'icon.png'))
  await renderSvg(svgOriginal, 64, path.join(OUT_DIR, 'icon@2x.png'))

  console.log('\nDone!')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
