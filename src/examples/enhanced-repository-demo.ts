#!/usr/bin/env node

/**
 * Demonstration of Enhanced Repository Pattern
 * 
 * This script demonstrates the new repository pattern capabilities:
 * - findByTypeOrderByCreatedAtDesc: Find memories by type, ordered by creation date (newest first)
 * - findAllOrderByCreatedAtDesc: Find all memories ordered by creation date (newest first)
 * - Support for complex queries with ordering, filtering, and pagination
 */

import aiagentmemoriesRepository, { AiAgentMemories } from '../entities/ai-agent-memories.js';
import Logger from '../utils/logger.js';

async function demonstrateEnhancedRepository() {
    try {
        Logger.info('Starting Enhanced Repository Pattern Demonstration');

        // Example 1: Using the enhanced finder methods
        Logger.info('=== Example 1: Enhanced Finder Methods ===');
        
        // This replaces: SELECT * FROM ai_agent_memories WHERE type = $1 ORDER BY created_at DESC
        const typeMemories = await aiagentmemoriesRepository.findByTypeOrderByCreatedAtDesc('conversation');
        Logger.info(`Found ${typeMemories?.length || 0} memories of type 'conversation' ordered by creation date`);

        // Example 2: Using findAll with ordering options  
        Logger.info('=== Example 2: FindAll with Ordering Options ===');
        
        // This replaces complex SQL with clean method calls
        const recentMemories = await aiagentmemoriesRepository.findAll({
            orderBy: [{ field: 'createdAt', direction: 'DESC' }],
            limit: 10
        });
        Logger.info(`Found ${recentMemories.length} most recent memories (limit 10)`);

        // Example 3: Using field-based queries with ordering
        Logger.info('=== Example 3: Field-based Queries with Ordering ===');
        
        const filteredMemories = await aiagentmemoriesRepository.getByFieldValues(
            { type: 'knowledge' },
            { 
                orderBy: [{ field: 'createdAt', direction: 'DESC' }],
                limit: 5 
            }
        );
        Logger.info(`Found ${filteredMemories?.length || 0} knowledge memories (limit 5, newest first)`);

        // Example 4: Demonstrating method naming conventions
        Logger.info('=== Example 4: Method Naming Conventions ===');
        Logger.info('Available enhanced methods:');
        Logger.info('- findByTypeOrderByCreatedAtDesc(type): Find by type, newest first');
        Logger.info('- findByTypeOrderByCreatedAtAsc(type): Find by type, oldest first');
        Logger.info('- findByType(type): Find by type, no specific ordering');
        Logger.info('- findAllOrderByCreatedAtDesc(): All memories, newest first');
        Logger.info('- findAllOrderByCreatedAtAsc(): All memories, oldest first');
        Logger.info('- findByTypeAndConfidenceOrderByCreatedAtDesc(type, confidence): Complex filtering with ordering');

        // Example 5: Creating a new memory to demonstrate the repository pattern
        Logger.info('=== Example 5: Creating Memory with Repository Pattern ===');
        
        const newMemory = new AiAgentMemories({
            type: 'demo',
            content: { 
                message: 'Enhanced repository pattern demonstration',
                features: ['ordering', 'filtering', 'pagination']
            },
            source: 'repository-demo',
            embedding: '[0.1,0.2,0.3,0.4,0.5]',
            tags: ['demo', 'repository', 'enhancement'],
            confidence: 0.99
        });

        Logger.info('New memory created with enhanced repository pattern');
        Logger.info(`Memory type: ${newMemory.getType()}`);
        Logger.info(`Memory content: ${JSON.stringify(newMemory.getContent(), null, 2)}`);
        Logger.info(`Memory tags: ${newMemory.getTags()?.join(', ')}`);
        Logger.info(`Memory confidence: ${newMemory.getConfidence()}`);
        Logger.info(`Memory source: ${newMemory.getSource()}`);

        Logger.info('=== Enhanced Repository Pattern Demonstration Complete ===');
        Logger.info('The repository now supports:');
        Logger.info('✓ Method-based ordering (e.g., findByTypeOrderByCreatedAtDesc)');
        Logger.info('✓ Flexible ordering options in base methods');
        Logger.info('✓ Pagination support (limit/offset)');
        Logger.info('✓ Complex filtering with multiple criteria');
        Logger.info('✓ Type-safe entity operations');
        Logger.info('✓ Automatic @Find method generation');

    } catch (error) {
        Logger.error('Error in enhanced repository demonstration:', error);
    }
}

// Export for potential use in other scripts
export { demonstrateEnhancedRepository };

// Run if this script is executed directly
if (require.main === module) {
    demonstrateEnhancedRepository()
        .then(() => {
            Logger.info('Demonstration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            Logger.error('Demonstration failed:', error);
            process.exit(1);
        });
}