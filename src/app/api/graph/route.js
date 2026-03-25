// src/app/api/graph/route.js
// Returns graph nodes and edges from SQLite

import { NextResponse } from 'next/server';
import { buildGraph } from '../../../lib/graphBuilder';

export async function GET() {
  try {
    const graph = buildGraph();
    return NextResponse.json(graph);
  } catch (error) {
    console.error('Graph build error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
