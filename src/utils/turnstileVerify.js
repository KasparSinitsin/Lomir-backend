async function verifyTurnstileToken(token) {
  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY,
      response: token,
    });

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    const data = await response.json();

    if (data.success) {
      return { success: true };
    }

    const errorCodes = Array.isArray(data["error-codes"])
      ? data["error-codes"].join(", ")
      : "CAPTCHA verification failed";

    return {
      success: false,
      error: errorCodes || "CAPTCHA verification failed",
    };
  } catch (error) {
    console.error("Turnstile verification error:", error);
    return {
      success: false,
      error: "CAPTCHA verification failed",
    };
  }
}

module.exports = {
  verifyTurnstileToken,
};
