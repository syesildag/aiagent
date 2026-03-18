import { Response } from "express";

/**
 * Sends a 401 response without a WWW-Authenticate header.
 * Omitting WWW-Authenticate prevents the browser's native login popup
 * so the frontend can handle the 401 itself.
 */
export function sendAuthenticationRequired(res: Response): void {
   res.status(401).json({ error: 'Authentication required.' });
}
