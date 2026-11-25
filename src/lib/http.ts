import "server-only";
import { NextResponse } from "next/server";
import { InputError } from "./mutations";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export async function handle(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e: any) {
    if (e instanceof InputError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Something went wrong on the server." }, 500);
  }
}

export function asOfParam(url: string, fallback: string) {
  const v = new URL(url).searchParams.get("asOf");
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}
