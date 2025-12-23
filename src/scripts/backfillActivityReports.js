/**
 * Migration script: Backfill embedded activity.reports from reports collection
 * 
 * This script syncs Report documents from the 'reports' collection into
 * embedded 'activity.reports' arrays for consistency.
 * 
 * Usage: node src/scripts/backfillActivityReports.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Report from '../models/report.js';
import Activity from '../models/activity.js';

dotenv.config();

async function backfillActivityReports() {
  try {
    console.log('🔄 Starting activity reports backfill...');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all activity reports
    const activityReports = await Report.find({ targetType: 'activity' })
      .sort({ createdAt: 1 })
      .lean();

    console.log(`📊 Found ${activityReports.length} activity reports in reports collection`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const report of activityReports) {
      try {
        const activity = await Activity.findById(report.targetId);
        
        if (!activity) {
          console.warn(`⚠️ Activity ${report.targetId} not found for report ${report._id}`);
          skipped++;
          continue;
        }

        // Check if this user's report already exists in embedded array
        const existingEmbedded = activity.reports?.find(
          r => String(r.user) === String(report.reportedBy)
        );

        if (existingEmbedded) {
          // Already exists, skip
          skipped++;
          continue;
        }

        // Add to embedded reports array
        if (!activity.reports) activity.reports = [];
        
        activity.reports.push({
          user: report.reportedBy,
          reason: report.reason,
          description: report.details || '',
          createdAt: report.createdAt || new Date()
        });

        await activity.save();
        updated++;
        
        if (updated % 10 === 0) {
          console.log(`⏳ Progress: ${updated} activities updated...`);
        }
      } catch (err) {
        console.error(`❌ Error processing report ${report._id}:`, err.message);
        errors++;
      }
    }

    console.log('\n✨ Migration complete!');
    console.log(`   Updated: ${updated} activities`);
    console.log(`   Skipped: ${skipped} (already embedded)`);
    console.log(`   Errors: ${errors}`);

    await mongoose.connection.close();
    console.log('👋 Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('💥 Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the migration
backfillActivityReports();
