// src/oauth.js
import dotenv from 'dotenv';
dotenv.config();

const CLIENT_ID = process.env.HACKCLUB_CLIENT_ID;
const CLIENT_SECRET = process.env.HACKCLUB_CLIENT_SECRET;
const REDIRECT_URI = process.env.OAUTH_REDIRECT_URI;

const AUTHORIZATION_URL = 'https://account.hackclub.com/oauth/authorize';
const TOKEN_URL = 'https://account.hackclub.com/oauth/token';
const USER_INFO_URL = 'https://account.hackclub.com/api/v1/me';

export function getAuthUrl() {
  if (!CLIENT_ID || !REDIRECT_URI) {
    throw new Error("Missing OAuth configuration (CLIENT_ID or REDIRECT_URI)");
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'email' // User requested basic scope, 'email' is in the provided list
  });
  return `${AUTHORIZATION_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error("Missing OAuth configuration for token exchange");
  }

  const body = {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code: code,
    grant_type: 'authorization_code'
  };

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to exchange token: ${response.status} ${text}`);
  }

  return response.json();
}

export async function getUserInfo(accessToken) {
  const response = await fetch(USER_INFO_URL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user info');
  }

  return response.json();
}
