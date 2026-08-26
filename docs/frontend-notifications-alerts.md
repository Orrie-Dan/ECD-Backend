# Notifications & Alerts - Frontend Integration Guide

## Overview

The backend exposes two complementary systems:

- **Notifications** — persistent, per-user records (stored in DB). Created when events happen (transfers, enrollments, screenings, etc.). Users can mark them as read.
- **Alerts** — computed on-demand, not stored. Calculated in real-time from current data (overdue screenings, absent children, stale referrals, etc.).

All endpoints require a valid JWT Bearer token.

---

## 1. Notifications API

Base path: `GET /api/v1/notifications`

### 1.1 List Notifications

```
GET /api/v1/notifications?page=1&pageSize=20&type=transfer_request&isRead=false
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed) |
| `pageSize` | number | 20 | Items per page (max 100) |
| `type` | string | — | Filter by notification type (see types below) |
| `isRead` | boolean | — | Filter by read status |

**Response:**

```json
{
  "items": [
    {
      "id": "uuid",
      "type": "transfer_request",
      "title": "Transfer request for John",
      "message": "A child transfer has been requested to your center.",
      "isRead": false,
      "readAt": null,
      "entityType": "child_transfer",
      "entityId": "uuid",
      "metadata": { "cronBatchDate": "2026-08-19" },
      "createdAt": "2026-08-19T12:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "totalPages": 3,
  "unreadCount": 7
}
```

### 1.2 Get Unread Count (for bell badge)

```
GET /api/v1/notifications/unread-count
```

**Response:**

```json
{ "unreadCount": 7 }
```

Use this for the notification bell badge. Poll every 30-60 seconds with TanStack Query's `refetchInterval`.

### 1.3 Mark Single as Read

```
POST /api/v1/notifications/:id/read
```

**Response:** Returns the updated `NotificationResponseDto`.

### 1.4 Mark All as Read

```
POST /api/v1/notifications/read-all
```

**Response:**

```json
{ "markedCount": 7 }
```

---

## 2. Notification Types

| Type | When Created | Relevant Entity |
|------|-------------|-----------------|
| `transfer_request` | ECD director initiates a transfer | `child_transfer` |
| `transfer_accepted` | Destination ECD director accepts | `child_transfer` |
| `transfer_cancelled` | Source ECD director cancels | `child_transfer` |
| `child_enrolled` | New child registered at center | `child` |
| `child_archived` | Child archived at center | `child` |
| `assessment_due` | (reserved for future use) | — |
| `referral_created` | New referral created | `referral` |
| `referral_updated` | Referral status changed | `referral` |
| `nutrition_alert` | Severe/moderate nutrition screening | `child_nutrition_screening` |
| `sted_followup` | STED assessment flags 6-month follow-up | `sted_assessment` |
| `compliance_update` | Assessment submitted/verified/rejected | `compliance_assessment` |
| `capacity_warning` | Center at/over capacity (daily cron) | `ecd_center` |
| `attendance_absence` | Child absent 3+ days in the last 7 days (daily cron) | `child` |
| `attendance_low_rate` | Center present-rate below 80% in the last 7 days (daily cron) | `ecd_center` |
| `general` | New user added to center, misc | `user_account` |

### Linking Notifications to Pages

Use `entityType` + `entityId` to create click-through navigation:

```typescript
function getNotificationLink(notification: Notification): string {
  const { entityType, entityId } = notification;
  if (!entityType || !entityId) return '/notifications';

  switch (entityType) {
    case 'child_transfer':
      return `/transfers/${entityId}`;
    case 'child':
      return `/children/${entityId}`;
    case 'child_nutrition_screening':
      return `/children/${entityId}`; // or nutrition detail
    case 'referral':
      return `/referrals/${entityId}`;
    case 'sted_assessment':
      return `/children/${entityId}`; // link to child's STED history
    case 'compliance_assessment':
      return `/compliance/${entityId}`;
    case 'ecd_center':
      return `/centers/${entityId}`;
    case 'user_account':
      return `/users/${entityId}`;
    default:
      return '/notifications';
  }
}
```

---

## 3. Alerts API

Base path: `GET /api/v1/alerts/follow-up`

### 3.1 Get Follow-Up Alerts

```
GET /api/v1/alerts/follow-up?category=all&limit=100&districtId=uuid&centerId=uuid
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `category` | string | `all` | Filter category (see below) |
| `limit` | number | 100 | Max items (1-200) |
| `districtId` | uuid | — | Scope to district |
| `centerId` | uuid | — | Scope to center |

**Categories:** `all`, `nutrition`, `attendance`, `referral`, `data_quality`, `sted`, `transfer`, `compliance`, `capacity`

**Response:**

```json
{
  "items": [
    {
      "id": "nutrition-severe-uuid",
      "category": "nutrition",
      "priority": "high",
      "code": "NUTRITION_SEVERE",
      "title": "Severe nutrition status",
      "description": "Jane Doe latest screening is severe",
      "centerId": "uuid",
      "centerName": "Kigali ECD Center",
      "childId": "uuid",
      "childName": "Jane Doe",
      "entityType": "child_nutrition_screening",
      "entityId": "uuid",
      "detectedAt": "2026-08-19T12:00:00.000Z",
      "metrics": [
        { "label": "Status", "value": "severe" }
      ]
    }
  ],
  "total": 15,
  "counts": {
    "nutrition": 5,
    "attendance": 3,
    "referral": 2,
    "data_quality": 1,
    "sted": 2,
    "transfer": 1,
    "compliance": 0,
    "capacity": 1,
    "high": 6
  },
  "districtId": "uuid",
  "centerId": null
}
```

### 3.2 Alert Codes Reference

| Code | Category | Priority | Meaning |
|------|----------|----------|---------|
| `NUTRITION_SEVERE` | nutrition | high | Child has severe nutrition status |
| `NUTRITION_AT_RISK` | nutrition | medium | Child is moderate or at-risk |
| `NUTRITION_REQUIRES_REFERRAL` | nutrition | high | Screening flagged for referral |
| `NUTRITION_OVERDUE` | nutrition | medium | No screening in 30+ days |
| `NUTRITION_NEVER_SCREENED` | nutrition | medium | Child never screened |
| `ATTENDANCE_ABSENCE_RISK` | attendance | high/medium | 3+ absences in 7 days |
| `ATTENDANCE_LOW_RATE` | attendance | high/medium | Center present-rate below 80% in 7 days |
| `REFERRAL_FOLLOW_UP` | referral | high/medium | Pending referral 7+ days |
| `DQ_MISSING_GUARDIAN_PHONE` | data_quality | low | Missing guardian phone |
| `DQ_NO_ATTENDANCE_TODAY` | data_quality | medium | Center has no attendance today |
| `STED_FOLLOWUP_OVERDUE` | sted | high | Follow-up date has passed |
| `STED_FOLLOWUP_UPCOMING` | sted | medium | Follow-up due within 7 days |
| `TRANSFER_PENDING_STALE` | transfer | high/medium | Transfer pending 7+ days |
| `COMPLIANCE_GAP_OVERDUE` | compliance | high | Gap target date passed |
| `COMPLIANCE_LAPSED` | compliance | medium | No assessment in 6+ months |
| `CENTER_AT_CAPACITY` | capacity | medium | Children >= center capacity |

---

## 4. Suggested UI Components

### 4.1 Notification Bell (header)

```
┌──────────────────────────────┐
│  [Logo]  Dashboard    🔔 (7) │  <-- badge shows unreadCount
└──────────────────────────────┘
```

- Poll `GET /notifications/unread-count` every 30s via `refetchInterval`
- On click, open dropdown/panel with recent notifications
- Each item shows icon (by type), title, time ago, read/unread dot
- "Mark all as read" button at top
- Click a notification: `POST /:id/read` then navigate to entity

**TanStack Query hook example:**

```typescript
// Poll unread count for bell badge
const { data } = useQuery({
  queryKey: ['notifications', 'unread-count'],
  queryFn: () => api.get('/notifications/unread-count'),
  refetchInterval: 30_000,
});

// Paginated notifications list
const { data: notifications } = useQuery({
  queryKey: ['notifications', { page, pageSize, type, isRead }],
  queryFn: () => api.get('/notifications', { params: { page, pageSize, type, isRead } }),
});

// Mark as read mutation
const markRead = useMutation({
  mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  },
});

// Mark all as read
const markAllRead = useMutation({
  mutationFn: () => api.post('/notifications/read-all'),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  },
});
```

### 4.2 Notification Type Icons (Lucide)

```typescript
import {
  ArrowRightLeft, UserPlus, Archive, Apple, Stethoscope,
  ClipboardCheck, AlertTriangle, Bell, Users, FileWarning
} from 'lucide-react';

const notificationIcons: Record<string, LucideIcon> = {
  transfer_request: ArrowRightLeft,
  transfer_accepted: ArrowRightLeft,
  transfer_cancelled: ArrowRightLeft,
  child_enrolled: UserPlus,
  child_archived: Archive,
  referral_created: Stethoscope,
  referral_updated: Stethoscope,
  nutrition_alert: Apple,
  sted_followup: ClipboardCheck,
  compliance_update: FileWarning,
  capacity_warning: Users,
  attendance_absence: AlertTriangle,
  attendance_low_rate: AlertTriangle,
  general: Bell,
};
```

### 4.3 Alerts Page / Panel

- Use existing `AlertsPanel` and `ActionAlertCard` components
- Add category filter tabs: Nutrition | Attendance | Referral | Data Quality | STED | Transfer | Compliance | Capacity
- Show `counts` from the response as badge numbers on each tab
- Color-code by priority: red = high, amber = medium, gray = low
- Use `counts.high` for a top-level "critical" badge
- Click an alert: navigate using `entityType` + `entityId` (same pattern as notifications)

**TanStack Query hook example:**

```typescript
const { data: alerts } = useQuery({
  queryKey: ['alerts', 'follow-up', { category, limit, districtId, centerId }],
  queryFn: () => api.get('/alerts/follow-up', {
    params: { category, limit, districtId, centerId }
  }),
});
```

### 4.4 Priority Styling

```typescript
const priorityStyles = {
  high:   { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    dot: 'bg-red-500' },
  medium: { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  low:    { bg: 'bg-slate-50',  border: 'border-slate-200',  text: 'text-slate-600',  dot: 'bg-slate-400' },
};
```

---

## 5. Role-Based Visibility

Notifications are automatically scoped — each user only sees their own notifications. No client-side filtering needed.

Alerts are scoped by role:
- **Caregiver / ECD Director** — see alerts for their center only
- **District Focal Person** — see alerts for all centers in their district
- **NCDA Admin** — see alerts for everything (can filter by district/center)

---

## 6. Recommended Routes

| Route | Component | Data Source |
|-------|-----------|-------------|
| `/notifications` | Full notifications page | `GET /notifications` |
| `/alerts` | Dedicated alerts page | `GET /alerts/follow-up` |

Both routes should be accessible to all roles. The bell icon + dropdown should be in the shared layout header across all role-specific layouts.
