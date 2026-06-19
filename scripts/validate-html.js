#!/usr/bin/env node
/**
 * validate-html.js
  * Extrae todos los bloques <script> inline de los HTML indicados
   * y valida su sintaxis JS con el parser de Node.js (acorn).
    * Si encuentra errores, imprime el detalle exacto y sale con código 1
     * (lo que cancela el deploy en Netlify).
      *
       * Uso: node scripts/validate-html.js
        */

'use strict';

const fs   = require('fs');
const path = require('path');
const { parse } = require('acorn');

// ─── Archivos HTML a validar ────────────────────────────────────────────────
const HTML_FILES = [
  path.join(__dirname, '..', 'index.html'),
  path.join(__dirname, '..', 'admin.html'),
];

// ─── Funciones críticas que deben existir en index.html ─────────────────────
const REQUIRED_FUNCTIONS = [
    'login',        // llamada desde onclick del botón Sign In
    'switchPage',   // navegación entre vistas
    'initApp',      // inicialización de la app
    'api',          // wrapper de fetch autenticado
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function extractScriptBlocks(html) {
  const blocks = [];
  const regex = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let lineOffset = 0;
    let searchFrom = 0;

  while ((match = regex.exec(html)) !== null) {
        // Calcular en qué línea del HTML empieza este bloque
    const before = html.slice(0, match.index);
    lineOffset = (before.match(/\n/g) || []).length + 1;
    blocks.push({ code: match[1], htmlLineStart: lineOffset });
        searchFrom = regex.lastIndex;
  }
      return blocks;
}

  function validateScript(code, htmlLineStart, fileName) {
    try {
      parse(code, {
              ecmaVersion: 2022,
              sourceType: 'script',   // inline scripts son 'script', no 'module'
      });
          return null; // sin errores
    } catch (e) {
      const absoluteLine = htmlLineStart + (e.loc ? e.loc.line : 0);
      return {
              file: fileName,
              htmlLine: absoluteLine,
              message: e.message,
      };
    }
  }

    function checkRequiredFunctions(html, fileName) {
      if (!fileName.endsWith('index.html')) return [];
      const errors = [];
      for (const fn of REQUIRED_FUNCTIONS) {
        // Busca definiciones: "function X(", "async function X(", "X = function", "X = async"
        const patterns = [
          new RegExp(`\\bfunction\\s+${fn}\\s*\\(`),
                     new RegExp(`\\basync\\s+function\\s+${fn}\\s*\\(`),
                       new RegExp(`\\b${fn}\\s*=\\s*(async\\s+)?function`),
                         new RegExp(`\\b${fn}\\s*=\\s*(async\\s+)?\\(`),
                                    ];
                                    const found = patterns.some(p => p.test(html));
                                    if (!found) {
                                      errors.push({
                                                file: fileName,
                                                htmlLine: '?',
                                        message: `FUNCIÓN REQUERIDA NO ENCONTRADA: "${fn}" — el botón/app la necesita pero no está definida en el código`,
                                      });
                                    }
                                    }
                                        return errors;
                                    }

                                    // ─── Main ────────────────────────────────────────────────────────────────────
                                    let totalErrors = 0;

                                    for (const filePath of HTML_FILES) {
                                      if (!fs.existsSync(filePath)) {
                                        console.warn(`⚠️  Archivo no encontrado, se omite: ${filePath}`);
                                            continue;
                                      }

                                        const html     = fs.readFileSync(filePath, 'utf8');
                                      const fileName = path.basename(filePath);
                                      const blocks   = extractScriptBlocks(html);

                                      console.log(`\n📄 Validando ${fileName} — ${blocks.length} bloque(s) <script> encontrado(s)`);

                                        // 1. Validar sintaxis de cada bloque
                                        let blockIndex = 0;
                                      for (const block of blocks) {
                                            blockIndex++;
                                        if (!block.code.trim()) continue; // bloque vacío, ignorar

                                        const error = validateScript(block.code, block.htmlLineStart, fileName);
                                        if (error) {
                                          console.error(`\n❌ ERROR DE SINTAXIS en ${error.file}`);
                                          console.error(`   Línea HTML ~${error.htmlLine}: ${error.message}`);
                                          console.error(`   (bloque <script> #${blockIndex}, que empieza en línea HTML ${block.htmlLineStart})`);
                                                totalErrors++;
                                        } else {
                                          console.log(`   ✅ Bloque #${blockIndex} (línea HTML ${block.htmlLineStart}) — OK`);
                                        }
                                          }

                                            // 2. Verificar que las funciones críticas existen
                                          const missingFnErrors = checkRequiredFunctions(html, fileName);
                                        for (const err of missingFnErrors) {
                                          console.error(`\n❌ ${err.message}`);
                                          console.error(`   Archivo: ${err.file}`);
                                              totalErrors++;
                                        }
                                      }

                                          // ─── Resultado final ─────────────────────────────────────────────────────────
                                          if (totalErrors > 0) {
                                            console.error(`\n🚨 VALIDACIÓN FALLIDA — ${totalErrors} error(es) encontrado(s).`);
                                            console.error('   El deploy ha sido CANCELADO. Corrige los errores y vuelve a hacer push.\n');
                                            process.exit(1);
                                          } else {
                                            console.log('\n🎉 Validación completada sin errores. El deploy puede continuar.\n');
                                            process.exit(0);
                                          }
