import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function resetUserStatus() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/wego-dev');
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    
    // Set all users to offline
    const result = await usersCollection.updateMany(
      {},
      { 
        $set: { 
          isOnline: false,
          lastActive: new Date()
        } 
      }
    );
    
    console.log(`✅ Reset ${result.modifiedCount} users to offline status`);
    console.log('✅ All user statuses have been reset!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

resetUserStatus();
