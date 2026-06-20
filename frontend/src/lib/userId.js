export function getOrCreateUserId() {
  let userId = localStorage.getItem("moodflow_user_id");
  if (!userId) {
    // Simple robust local unique ID generation
    userId = 'user_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
    localStorage.setItem("moodflow_user_id", userId);
  }
  return userId;
}
