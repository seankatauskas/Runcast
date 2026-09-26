/**
 * Compatibility entry for development clients that cached the app's
 * pre-Router bundle URL. New Expo sessions resolve `expo-router/entry`
 * directly from package.json; stale sessions can still request this file
 * and arrive at the same Router root.
 */
import 'expo-router/entry';
