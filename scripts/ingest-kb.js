require('dotenv').config();

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { Client } = require('pg');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const RAW_DIR = path.join(process.cwd(), 'kb', 'raw-pdfs');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

// Aproximación simple; suficiente para chunking práctico.
function estimateTokens(text) {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

function cleanText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/Page \d+ of \d+/gi, '')
    .replace(/\u0000/g, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
}

function splitIntoParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);
}

function inferMetadata(filename, text) {
  const lower = `${filename} ${text.slice(0, 3000)}`.toLowerCase();

  if (lower.includes('confidence') || lower.includes('speaking')) {
    return {
      category: 'communication',
      tags: ['confidence', 'speaking', 'communication']
    };
  }

  if (lower.includes('effective') || lower.includes('time')) {
    return {
      category: 'productivity',
      tags: ['productivity', 'effectiveness', 'time-management']
    };
  }

  if (lower.includes('ric') || lower.includes('accountability')) {
    return {
      category: 'accountability',
      tags: ['accountability', 'ric', 'leadership']
    };
  }

  return {
    category: 'general',
    tags: ['general']
  };
}

function buildChunks(text, baseMetadata) {
  const paragraphs = splitIntoParagraphs(text);

  const chunks = [];
  let current = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  const TARGET_TOKENS = 700;
  const MAX_TOKENS = 900;
  const OVERLAP_PARAGRAPHS = 1;

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);

    if (currentTokens + paragraphTokens > MAX_TOKENS && current.length > 0) {
      const content = current.join('\n\n').trim();

      chunks.push({
        chunk_index: chunkIndex++,
        heading: null,
        content,
        token_count: estimateTokens(content),
        metadata: baseMetadata
      });

      current = current.slice(Math.max(0, current.length - OVERLAP_PARAGRAPHS));
      currentTokens = estimateTokens(current.join('\n\n'));
    }

    current.push(paragraph);
    currentTokens += paragraphTokens;

    if (currentTokens >= TARGET_TOKENS) {
      const content = current.join('\n\n').trim();

      chunks.push({
        chunk_index: chunkIndex++,
        heading: null,
        content,
        token_count: estimateTokens(content),
        metadata: baseMetadata
      });

      current = current.slice(Math.max(0, current.length - OVERLAP_PARAGRAPHS));
      currentTokens = estimateTokens(current.join('\n\n'));
    }
  }

  if (current.length > 0) {
    const content = current.join('\n\n').trim();
    chunks.push({
      chunk_index: chunkIndex++,
      heading: null,
      content,
      token_count: estimateTokens(content),
      metadata: baseMetadata
    });
  }

  return chunks;
}

async function embedText(text) {
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS
  });

  return res.data[0].embedding;
}

async function upsertDocument(filename, metadata) {
  const title = path.basename(filename, path.extname(filename));

  const result = await client.query(
    `
    insert into kb_documents (title, source_file, category, author)
    values ($1, $2, $3, $4)
    on conflict (source_file)
    do update set
      title = excluded.title,
      category = excluded.category,
      author = excluded.author
    returning id
    `,
    [title, filename, metadata.category || null, null]
  );

  return result.rows[0].id;
}

async function deleteExistingChunks(documentId) {
  await client.query('delete from kb_chunks where document_id = $1', [documentId]);
}

async function insertChunk(documentId, chunk) {
  await client.query(
    `
    insert into kb_chunks (
      document_id,
      chunk_index,
      heading,
      content,
      token_count,
      metadata,
      embedding
    )
    values ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      documentId,
      chunk.chunk_index,
      chunk.heading,
      chunk.content,
      chunk.token_count,
      JSON.stringify(chunk.metadata),
      `[${chunk.embedding.join(',')}]`
    ]
  );
}

async function processPdf(filepath) {
  const filename = path.basename(filepath);
  const buffer = fs.readFileSync(filepath);
  const parsed = await pdfParse(buffer);

  const cleaned = cleanText(parsed.text);
  const metadata = {
    book: path.basename(filename, path.extname(filename)),
    ...inferMetadata(filename, cleaned)
  };

  const documentId = await upsertDocument(filename, metadata);
  await deleteExistingChunks(documentId);

  const chunks = buildChunks(cleaned, metadata);

  console.log(`\nProcessing ${filename}`);
  console.log(`Chunks: ${chunks.length}`);

  for (const chunk of chunks) {
    const embedding = await embedText(chunk.content);
    await insertChunk(documentId, {
      ...chunk,
      embedding
    });
    process.stdout.write('.');
  }

  console.log(`\nDone: ${filename}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

  await client.connect();

  const files = fs
    .readdirSync(RAW_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'));

  if (files.length === 0) {
    throw new Error(`No PDFs found in ${RAW_DIR}`);
  }

  for (const file of files) {
    await processPdf(path.join(RAW_DIR, file));
  }

  await client.end();
  console.log('\nKB ingest complete.');
}

main().catch(async err => {
  console.error(err);
  try {
    await client.end();
  } catch (_) {}
  process.exit(1);
});
