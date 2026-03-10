import cron from 'node-cron';
import Event from '../models/event.js';
import Chat from '../models/chat.js';

export const startCleanupCron = () => {
  cron.schedule('0 0 * * *', async () => {
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - 3);

      const expiredEvents = await Event.find({
        date: { $lte: targetDate }
      });

      for (const event of expiredEvents) {
        await Chat.deleteMany({ 'groupInfo.relatedActivity': event._id });
        
        await Chat.deleteMany({ 
          type: 'group', 
          name: event.title 
        });

        await Event.findByIdAndDelete(event._id);
      }
    } catch (error) {
      console.error(error);
    }
  });
};