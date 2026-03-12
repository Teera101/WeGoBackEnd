import cron from 'node-cron';
import Activity from '../models/activity.js';
import Chat from '../models/chat.js';
import Group from '../models/group.js';

export const startCleanupCron = (io) => {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const targetDate = new Date(now.getTime() - 60000); 

      const activities = await Activity.find();

      for (const activity of activities) {
        if (!activity.date || !activity.time) continue;

        try {
          const dateStr = new Date(activity.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
          const exactEventDate = new Date(`${dateStr}T${activity.time}:00+07:00`);

          if (exactEventDate <= targetDate) {
            if (activity.chat) {
              await Chat.findByIdAndDelete(activity.chat);
            }
            await Group.deleteMany({ relatedActivity: activity._id.toString() });
            await Activity.findByIdAndDelete(activity._id);
            
            if (io) {
              io.emit('activity:delete', { _id: activity._id });
            }
          }
        } catch (err) {
        }
      }
    } catch (error) {
    }
  });
};