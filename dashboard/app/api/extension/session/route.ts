import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
};

function getSupabaseClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value ?? null;
        },
        set(_name: string, _value: string, _options: CookieOptions) {
          // read-only in this route
        },
        remove(_name: string, _options: CookieOptions) {
          // read-only in this route
        },
      },
    },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient(request);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return new NextResponse(JSON.stringify({ error: "not_authenticated" }), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }

  // NEW
  const [
    { data: profile },
    { data: activeJobs },
    {
      data: { session },
    },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("gemini_key, groq_key")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("jobs")
      .select("*")
      .eq("recruiter_id", user.id)
      .eq("is_active", true),
    supabase.auth.getSession(),
  ]);

  return new NextResponse(
    JSON.stringify({
      user: { id: user.id, email: user.email },
      profile,
      activeJobs,
      accessToken: session?.access_token ?? null,
    }),
    { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
}
