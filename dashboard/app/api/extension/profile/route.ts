import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
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

export async function POST(request: NextRequest) {
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

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  }

  const { gemini_key, groq_key } = body;

  // Update profile with new keys
  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      gemini_key: gemini_key?.trim() || null,
      groq_key: groq_key?.trim() || null,
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("Profile update error:", updateError);
    return new NextResponse(
      JSON.stringify({ error: "failed_to_save_profile" }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      },
    );
  }

  return new NextResponse(
    JSON.stringify({ success: true, message: "Profile updated successfully" }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    },
  );
}
