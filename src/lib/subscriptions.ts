import { prisma } from './prisma.js';

/**
 * Check for expired subscriptions and downgrade users to FREE plan.
 * This should be run periodically (e.g., daily via cron or on server startup).
 */
export async function cleanupExpiredSubscriptions(): Promise<number> {
  const now = new Date();
  
  try {
    // Find all users with PRO/WHATSAPP plan but expired subscriptions
    const expiredUsers = await prisma.user.findMany({
      where: {
        plan: { in: ['PRO', 'WHATSAPP'] },
        subscriptions: {
          none: {
            active: true,
            endDate: { gte: now }
          }
        }
      },
      select: { id: true, email: true, plan: true }
    });

    if (expiredUsers.length === 0) {
      console.log('No expired subscriptions found');
      return 0;
    }

    console.log(`Found ${expiredUsers.length} users with expired subscriptions`);

    // Downgrade each user
    for (const user of expiredUsers) {
      console.log(`Downgrading user ${user.email} from ${user.plan} to FREE`);
      
      // Deactivate all their subscriptions
      await prisma.subscription.updateMany({
        where: { userId: user.id, active: true },
        data: { active: false }
      });

      // Downgrade to FREE
      await prisma.user.update({
        where: { id: user.id },
        data: { plan: 'FREE' }
      });
    }

    console.log(`Successfully downgraded ${expiredUsers.length} users to FREE plan`);
    return expiredUsers.length;
  } catch (error) {
    console.error('Error cleaning up expired subscriptions:', error);
    throw error;
  }
}

/**
 * Reset weekly upload counts for FREE tier users.
 * This should be run weekly (e.g., every Monday at midnight).
 */
export async function resetWeeklyUploadCounts(): Promise<number> {
  try {
    const result = await prisma.user.updateMany({
      where: { plan: 'FREE' },
      data: { uploadCount: 0 }
    });

    console.log(`Reset upload counts for ${result.count} FREE tier users`);
    return result.count;
  } catch (error) {
    console.error('Error resetting upload counts:', error);
    throw error;
  }
}

/**
 * Get subscription stats for admin dashboard.
 */
export async function getSubscriptionStats() {
  const [totalUsers, proUsers, whatsappUsers, activeSubscriptions] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { plan: 'PRO' } }),
    prisma.user.count({ where: { plan: 'WHATSAPP' } }),
    prisma.subscription.count({ where: { active: true, endDate: { gte: new Date() } } })
  ]);

  return {
    totalUsers,
    proUsers,
    whatsappUsers,
    freeUsers: totalUsers - proUsers - whatsappUsers,
    activeSubscriptions
  };
}
