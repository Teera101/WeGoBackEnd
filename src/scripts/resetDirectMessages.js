import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function resetDirectMessages() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/WeGo');
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    
    // Check if collection exists
    const collections = await db.listCollections({ name: 'directmessages' }).toArray();
    
    if (collections.length > 0) {
      console.log('📦 Found directmessages collection');
      const collection = db.collection('directmessages');
      
      // List all indexes
      const indexes = await collection.indexes();
      console.log('Current indexes:', JSON.stringify(indexes, null, 2));
      
      // Drop the collection entirely
      await collection.drop();
      console.log('✅ Dropped directmessages collection');
    } else {
      console.log('ℹ️  Collection does not exist yet - will be created fresh');
    }
    
    console.log('✅ Reset complete! Restart your server.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

resetDirectMessages();
