# Riderr Push Notifications — React Native App Integration

## Overview

This document covers everything you need to do inside your **Expo React Native app** to receive push notifications from the Riderr backend.

The backend is already fully set up. Your job on the frontend is:

1. Install the required packages
2. Configure `app.json`
3. Request permission and get the push token
4. Send the token to the backend after login
5. Handle incoming notifications
6. Navigate based on notification data

---

## 1. Install Packages

```bash
npx expo install expo-notifications expo-device expo-constants
```

---

## 2. Configure app.json

```json
{
  "expo": {
    "name": "Riderr",
    "slug": "riderr",
    "scheme": "riderr",

    "android": {
      "package": "com.riderr.app",
      "googleServicesFile": "./google-services.json"
    },

    "ios": {
      "bundleIdentifier": "com.riderr.app"
    },

    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#ffffff",
          "defaultChannel": "default"
        }
      ]
    ]
  }
}
```

> The `google-services.json` file comes from your Firebase project. Place it in the root of your Expo project.

---

## 3. Create the Notification Service

Create this file in your app:

```
src/services/notifications.js
```

```js
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Controls how notifications appear when the app is OPEN
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request permission and return the Expo push token.
 * Call this after the user logs in.
 */
export async function registerForPushNotifications() {
  // Push notifications don't work on emulators
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  // Create Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
      sound: 'default',
    });
  }

  // Check existing permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Ask if not already granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('Notification permission denied');
    return null;
  }

  // Get the Expo push token
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    throw new Error('EAS Project ID not found in app config');
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

  return token; // "ExponentPushToken[xxxxxxxxxxxxxxxxxxxx]"
}
```

---

## 4. Send the Token to the Backend

Call this right after a successful login:

```js
import { registerForPushNotifications } from '../services/notifications';
import { Platform } from 'react-native';

async function onLoginSuccess(userToken) {
  const pushToken = await registerForPushNotifications();

  if (pushToken) {
    await fetch('https://your-api.com/api/notifications/push-token', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        token: pushToken,
        platform: Platform.OS, // 'android' or 'ios'
      }),
    });
  }
}
```

> The backend endpoint is `PUT /api/notifications/push-token`. It saves the token on the logged-in user. This is already implemented.

---

## 5. Handle Notifications in Your Root Component

Add this to your root `App.js` or root layout file:

```js
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useNavigation } from '@react-navigation/native';

export default function App() {
  const navigationRef = useRef(null);

  useEffect(() => {
    // Fired when user TAPS a notification (app was background/closed)
    const tapSubscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        handleNotificationNavigation(data, navigationRef.current);
      }
    );

    // Fired when notification arrives while app is OPEN
    const foregroundSubscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        const data = notification.request.content.data;
        console.log('Notification received in foreground:', data);
        // Optionally show an in-app banner here
      }
    );

    return () => {
      tapSubscription.remove();
      foregroundSubscription.remove();
    };
  }, []);

  return (
    // ... your navigation container
  );
}
```

---

## 6. Handle Navigation from Notification Data

The backend sends a `data` object with every notification. Use it to navigate the user to the right screen.

```js
function handleNotificationNavigation(data, navigation) {
  if (!navigation || !data?.type) return;

  switch (data.type) {
    case 'delivery':
      if (data.deliveryId) {
        navigation.navigate('DeliveryDetails', { deliveryId: data.deliveryId });
      }
      break;

    case 'payment':
      if (data.deliveryId) {
        navigation.navigate('Payment', { deliveryId: data.deliveryId });
      }
      break;

    case 'driver':
      navigation.navigate('DriverDashboard');
      break;

    case 'support':
      if (data.ticketId) {
        navigation.navigate('SupportTicket', { ticketId: data.ticketId });
      }
      break;

    case 'company':
      navigation.navigate('CompanyDashboard');
      break;

    default:
      navigation.navigate('Notifications');
  }
}
```

---

## 7. Handle App Opened FROM a Notification (Cold Start)

When the app is completely closed and the user taps a notification, use this to check on startup:

```js
import * as Notifications from 'expo-notifications';

async function checkInitialNotification(navigation) {
  const response = await Notifications.getLastNotificationResponseAsync();

  if (response) {
    const data = response.notification.request.content.data;
    handleNotificationNavigation(data, navigation);
  }
}

// Call this once after your navigation is ready
useEffect(() => {
  checkInitialNotification(navigation);
}, []);
```

---

## 8. Notification Data Reference

Every notification from the backend includes a `data` object. Here is what each type sends:

| Event | `type` | Key fields in `data` |
|---|---|---|
| Delivery created | `delivery` | `deliveryId`, `referenceId` |
| Driver assigned | `delivery` | `deliveryId`, `driverName`, `estimatedTime` |
| Package picked up | `delivery` | `deliveryId`, `driverName` |
| Delivery completed | `delivery` | `deliveryId`, `referenceId`, `requestRating: true` |
| Delivery cancelled | `delivery` | `deliveryId`, `reason` |
| Payment required | `payment` | `deliveryId`, `amount`, `driverName`, `requiresPayment: true` |
| Payment success | `payment` | `deliveryId`, `amount` |
| Payment failed | `payment` | `deliveryId`, `amount` |
| Ride accepted | `delivery` | `rideId`, `driverName` |
| Ride completed | `delivery` | `rideId`, `fare`, `requestRating: true` |
| New ride request (driver) | `delivery` | `rideId`, `pickupAddress` |
| Driver verified | `driver` | `driverId` |
| Driver suspended | `driver` | `driverId`, `reason` |
| New driver request (company) | `company` | `driverId`, `driverName` |
| Support ticket created | `support` | `ticketId` |
| Support reply | `support` | `ticketId`, `senderName` |
| Chat message | `system` | `deliveryId`, `senderName` |

Every notification also includes `notificationId` in `data` — use it to mark the notification as read:

```js
// Mark as read when user taps and navigates
await fetch(`https://your-api.com/api/notifications/${data.notificationId}/read`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${userToken}` },
});
```

---

## 9. Fetch In-App Notification List

To show a notification bell with unread count:

```js
// Get unread count
const res = await fetch('https://your-api.com/api/notifications/unread-count', {
  headers: { Authorization: `Bearer ${userToken}` },
});
const { data } = await res.json();
// data.count = number of unread notifications

// Get notification list
const res = await fetch('https://your-api.com/api/notifications?page=1&limit=20', {
  headers: { Authorization: `Bearer ${userToken}` },
});
const { data, pagination } = await res.json();
// data = array of notifications
// pagination.unreadCount = total unread

// Mark all as read
await fetch('https://your-api.com/api/notifications/read-all', {
  method: 'PUT',
  headers: { Authorization: `Bearer ${userToken}` },
});
```

---

## 10. Complete API Reference

All routes require `Authorization: Bearer <token>` header.

| Method | Endpoint | Description |
|---|---|---|
| `PUT` | `/api/notifications/push-token` | Register/update push token |
| `GET` | `/api/notifications` | Get notifications (paginated) |
| `GET` | `/api/notifications/unread-count` | Get unread count |
| `PUT` | `/api/notifications/read-all` | Mark all as read |
| `PUT` | `/api/notifications/:id/read` | Mark one as read |
| `PUT` | `/api/notifications/:id/click` | Mark one as clicked |
| `DELETE` | `/api/notifications/:id` | Delete one notification |
| `DELETE` | `/api/notifications/clear-read` | Delete all read notifications |

Query params for `GET /api/notifications`:

| Param | Type | Example |
|---|---|---|
| `page` | number | `1` |
| `limit` | number | `20` |
| `unreadOnly` | boolean | `true` |
| `type` | string | `delivery`, `payment`, `driver`, `support`, `company`, `system` |
| `priority` | string | `low`, `medium`, `high`, `urgent` |

---

## 11. Important Notes

- Push notifications **do not work in Expo Go** — you must build with EAS
- Always call `registerForPushNotifications()` **after login**, not before, so the token is saved against the correct user
- If a user logs out, you should clear the token from the backend:

```js
async function onLogout(userToken) {
  await fetch('https://your-api.com/api/notifications/push-token', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
    },
    body: JSON.stringify({ token: null }),
  });
}
```

- The backend automatically removes tokens that return `DeviceNotRegistered` from Expo — you don't need to handle that on the frontend
- Notifications work when the app is **open**, **backgrounded**, and **completely closed**
