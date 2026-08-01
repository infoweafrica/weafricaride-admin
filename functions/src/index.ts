import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

// Send notification to a specific user
export const sendNotification = functions.https.onCall(async (data: any, context: any) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'You must be logged in to send notifications'
    );
  }

  const { userId, title, body, imageUrl, notificationData } = data;

  if (!userId || !title || !body) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required fields: userId, title, or body'
    );
  }

  try {
    // Get user's FCM token
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    const userData = userDoc.data();
    const fcmToken = userData?.fcmToken;

    if (!fcmToken) {
      throw new Error('User has no FCM token');
    }

    // Send notification
    const message = {
      notification: {
        title: title,
        body: body,
        imageUrl: imageUrl || '',
      },
      data: notificationData || {},
      token: fcmToken,
    };

    const response = await admin.messaging().send(message);

    // Save notification to Firestore
    await admin.firestore().collection('notifications').add({
      userId: userId,
      title: title,
      body: body,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'sent',
      fcmResponse: response,
      sentBy: context.auth.uid,
    });

    return { success: true, messageId: response };
  } catch (error: any) {
    console.error('Error sending notification:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Unknown error occurred');
  }
});

// Send broadcast notification to all users
export const sendBroadcast = functions.https.onCall(async (data: any, context: any) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const { title, body, imageUrl, notificationData } = data;

  if (!title || !body) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing title or body');
  }

  try {
    // Get all users with FCM tokens
    const usersSnapshot = await admin.firestore()
      .collection('users')
      .where('fcmToken', '!=', null)
      .get();

    const tokens: string[] = [];
    const userIds: string[] = [];
    
    usersSnapshot.forEach(doc => {
      const token = doc.data().fcmToken;
      const userId = doc.id;
      if (token) {
        tokens.push(token);
        userIds.push(userId);
      }
    });

    if (tokens.length === 0) {
      return { success: false, message: 'No users with FCM tokens found' };
    }

    // Send notification to all tokens
    const message = {
      notification: {
        title: title,
        body: body,
        imageUrl: imageUrl || '',
      },
      data: notificationData || {},
      tokens: tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Save broadcast to Firestore
    const broadcastRef = await admin.firestore().collection('broadcasts').add({
      title: title,
      body: body,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      totalTokens: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      sentBy: context.auth.uid,
      userIds: userIds,
    });

    return {
      success: true,
      broadcastId: broadcastRef.id,
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (error: any) {
    console.error('Error sending broadcast:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Unknown error occurred');
  }
});

// Get notification history (for admin dashboard)
export const getNotificationHistory = functions.https.onCall(async (data: any, context: any) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const { limit = 50, userId } = data;

  try {
    let query: admin.firestore.Query = admin.firestore()
      .collection('notifications')
      .orderBy('sentAt', 'desc')
      .limit(limit);

    if (userId) {
      query = query.where('userId', '==', userId);
    }

    const snapshot = await query.get();
    const notifications: any[] = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        ...data,
        sentAt: data.sentAt?.toDate() || null,
      });
    });

    return { notifications };
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    throw new functions.https.HttpsError('internal', error.message || 'Unknown error occurred');
  }
});