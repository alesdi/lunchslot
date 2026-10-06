import { errorResponse } from "@/lib/http";
import { createMeeting, CreateMeetingInput } from "@/lib/service";

export async function POST(req: Request) {
  try {
    const input = CreateMeetingInput.parse(await req.json());
    return Response.json(await createMeeting(req, input));
  } catch (e) {
    return errorResponse(e);
  }
}
