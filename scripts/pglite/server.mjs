// Servidor PostgreSQL local baseado em PGlite (WASM) com a extensão pgvector.
//
// Uso: alternativa de DESENVOLVIMENTO quando o Docker não está disponível.
//   pnpm install            (nesta pasta)
//   PGLITE_PORT=5433 PGLITE_DATA=../../data/pglite node server.mjs
//
// Limitações conhecidas: aceita UMA conexão por vez (use pool pequeno / StaticPool),
// não substitui o PostgreSQL real em produção.
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const dataDir = process.env.PGLITE_DATA || undefined
const port = Number(process.env.PGLITE_PORT || 5433)

const db = await PGlite.create({ dataDir, extensions: { vector } })
await db.exec('CREATE EXTENSION IF NOT EXISTS vector;')

const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' })
await server.start()
console.log(`[pglite] escutando em 127.0.0.1:${port}${dataDir ? ` (dados em ${dataDir})` : ' (memória)'}`)

const shutdown = async () => {
  await server.stop()
  await db.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
