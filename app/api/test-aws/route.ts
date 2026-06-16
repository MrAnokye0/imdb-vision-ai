import { RekognitionClient, ListCollectionsCommand } from "@aws-sdk/client-rekognition";

export async function GET() {
  const region          = process.env.AWS_REGION;
  const accessKeyId     = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  // 1. Check env vars are present
  const envCheck = {
    region,
    accessKeyExists:  !!accessKeyId,
    secretExists:     !!secretAccessKey,
  };

  if (!accessKeyId || !secretAccessKey || !region) {
    return Response.json({
      ...envCheck,
      connected: false,
      error: "One or more AWS env vars are missing in .env.local",
    }, { status: 500 });
  }

  // 2. Attempt a real (lightweight) AWS API call to verify credentials work
  try {
    const client = new RekognitionClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });

    // ListCollections is the cheapest call — returns immediately, no data needed
    await client.send(new ListCollectionsCommand({ MaxResults: 1 }));

    return Response.json({
      ...envCheck,
      connected: true,
      message:   "AWS credentials are valid and Rekognition is reachable.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({
      ...envCheck,
      connected: false,
      error:     message,
    }, { status: 500 });
  }
}
