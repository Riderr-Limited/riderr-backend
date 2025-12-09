# riderr-backend



1. Enhanced Validation:
Added validator library for better validation

Email validation with proper format checking

Phone number validation for international format

URL validation for avatar

Role-based validation for companyId

2. New Fields:
isActive: For soft deletion

refreshToken: To store JWT refresh tokens

loginAttempts & lockUntil: For brute force protection

Password reset and email verification fields

Better defaults for timestamps

3. Security Features:
Password field has select: false by default

Sensitive fields have select: false

Brute force protection with account locking

Password reset token generation

4. Virtual Fields:
riderProfile: Links to Rider model

company: Links to Company model

fullProfile: Returns safe user data

isOnline: Calculates online status

isLocked: Checks if account is locked

requiresVerification: For rider verification flow

5. Instance Methods:
comparePassword(): Safe password comparison

generatePasswordResetToken(): Secure token generation

generateEmailVerificationToken(): For email verification

incrementLoginAttempts() & resetLoginAttempts(): For login security

6. Static Methods:
findByEmailOrPhone(): Find user by either identifier

findActiveUsers(): Get active users by role

getUserStats(): Aggregation for admin dashboard

searchUsers(): Advanced search with pagination

7. Query Helpers:
Chainable query methods like .byRole(), .byCompany(), etc.

Makes queries more readable

8. Indexes:
Added comprehensive indexes for performance

Compound indexes for common query patterns

9. Middleware:
Pre-save hooks for data cleaning

Pre-find hooks for default filters

Post hooks for logging/notifications






Authentication (Public):
POST /api/auth/signup - Register new user

POST /api/auth/signup/company/:companyId - Register rider

POST /api/auth/login - Login

POST /api/auth/refresh - Refresh token

Authentication (Private):
POST /api/auth/logout - Logout

POST /api/auth/logout-all - Logout all devices

User Profile (Private):
GET /api/users/me - Get my profile

PATCH /api/users/me - Update my profile

PUT /api/users/me/password - Change password

User Management:
GET /api/users/:id - Get user by ID

Company Admin:
POST /api/users/companies/:companyId/riders - Create rider

GET /api/users/companies/:companyId/riders - List riders

DELETE /api/users/companies/:companyId/riders/:riderId - Deactivate rider

Admin Only:
GET /api/users - Get all users

PATCH /api/users/:id/status - Update user status

DELETE /api/users/:id - Deactivate user

GET /api/users/stats/overview - User statistics