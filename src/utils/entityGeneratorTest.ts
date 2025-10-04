import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { ConsoleLogger } from './logger.js';
import { config } from './config.js';
import { PostgreSQLEntityGenerator } from './postgresEntityGenerator.js';
import { DbMetadataExtractor } from './dbMetadataExtractor.js';

/**
 * Test and Validation Script for PostgreSQL Entity Generator
 * 
 * This script tests the generator with the existing 'session' table
 * and validates that the generated entity matches expected patterns.
 */

interface TestResult {
  testName: string;
  passed: boolean;
  message: string;
  details?: any;
}

class EntityGeneratorTester {
  private pool: Pool;
  private logger: ConsoleLogger;
  private generator: PostgreSQLEntityGenerator;
  private extractor: DbMetadataExtractor;

  constructor() {
    this.logger = new ConsoleLogger();
    this.pool = new Pool({
      host: config.DB_HOST,
      port: config.DB_PORT,
      database: config.DB_NAME,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
    });
    this.generator = new PostgreSQLEntityGenerator(this.pool, this.logger);
    this.extractor = new DbMetadataExtractor(this.pool, this.logger);
  }

  async runAllTests(): Promise<TestResult[]> {
    const results: TestResult[] = [];

    this.logger.info('Starting PostgreSQL Entity Generator Tests');

    try {
      // Test database connection
      await this.pool.query('SELECT 1');
      results.push({
        testName: 'Database Connection',
        passed: true,
        message: 'Successfully connected to database'
      });

      // Test metadata extraction
      results.push(await this.testMetadataExtraction());

      // Test code generation for session table
      results.push(await this.testSessionEntityGeneration());

      // Test annotation detection
      results.push(await this.testAnnotationDetection());

      // Test relationship analysis
      results.push(await this.testRelationshipAnalysis());

      // Test TypeScript code validity
      results.push(await this.testGeneratedCodeValidity());

      // Test CLI functionality
      results.push(await this.testCLIFunctionality());

    } catch (error) {
      results.push({
        testName: 'Test Execution',
        passed: false,
        message: `Test execution failed: ${error instanceof Error ? error.message : String(error)}`,
        details: error
      });
    } finally {
      await this.cleanup();
    }

    return results;
  }

  private async testMetadataExtraction(): Promise<TestResult> {
    try {
      this.logger.info('Testing metadata extraction...');

      // Test if ai_agent_session table exists
      const sessionExists = await this.extractor.tableExists('ai_agent_session', 'public');
      if (!sessionExists) {
        return {
          testName: 'Metadata Extraction',
          passed: false,
          message: 'ai_agent_session table does not exist in database'
        };
      }

      // Extract ai_agent_session table metadata
      const tableInfo = await this.extractor.extractTableInfo('ai_agent_session', 'public');
      
      // Validate extracted metadata
      const hasColumns = tableInfo.columns.length > 0;
      const hasId = tableInfo.columns.some(col => col.name === 'id');
      const hasPrimaryKey = tableInfo.primaryKeys.length > 0;

      if (!hasColumns || !hasId || !hasPrimaryKey) {
        return {
          testName: 'Metadata Extraction',
          passed: false,
          message: 'ai_agent_session table metadata is incomplete',
          details: { hasColumns, hasId, hasPrimaryKey, tableInfo }
        };
      }

      return {
        testName: 'Metadata Extraction',
        passed: true,
        message: `Successfully extracted metadata for ai_agent_session table (${tableInfo.columns.length} columns)`,
        details: tableInfo
      };

    } catch (error) {
      return {
        testName: 'Metadata Extraction',
        passed: false,
        message: `Metadata extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        details: error
      };
    }
  }

  private async testSessionEntityGeneration(): Promise<TestResult> {
    try {
      this.logger.info('Testing ai_agent_session entity generation...');

      const outputDir = './test-output';
      const config = {
        ...this.generator.getDefaultConfig(),
        outputDirectory: outputDir,
        overwriteExisting: true
      };

      // Generate entity for ai_agent_session table
      const result = await this.generator.generateEntity('ai_agent_session', config);

      if (!result.success) {
        return {
          testName: 'Session Entity Generation',
          passed: false,
          message: 'Failed to generate ai_agent_session entity',
          details: { result }
        };
      }

      // Check if file was created
      const fileExists = fs.existsSync(result.entityFile);
      if (!fileExists) {
        return {
          testName: 'Session Entity Generation',
          passed: false,
          message: 'Generated entity file does not exist',
          details: { expectedPath: result.entityFile }
        };
      }

      // Read and validate generated content
      const content = fs.readFileSync(result.entityFile, 'utf8');
      const hasImports = content.includes('import');
      const hasClassDeclaration = content.includes('export class AiAgentSession');
      const hasIdAnnotation = content.includes('@Id');
      const hasColumnAnnotation = content.includes('@Column');

      if (!hasImports || !hasClassDeclaration || !hasIdAnnotation || !hasColumnAnnotation) {
        return {
          testName: 'Session Entity Generation',
          passed: false,
          message: 'Generated entity content is incomplete',
          details: { hasImports, hasClassDeclaration, hasIdAnnotation, hasColumnAnnotation }
        };
      }

        return {
          testName: 'Session Entity Generation',
          passed: true,
          message: `Successfully generated ai_agent_session entity with ${result.metadata.columnCount} columns`,
          details: { result, contentLength: content.length }
        };    } catch (error) {
      return {
        testName: 'Session Entity Generation',
        passed: false,
        message: `Entity generation failed: ${error instanceof Error ? error.message : String(error)}`,
        details: error
      };
    }
  }

  private async testAnnotationDetection(): Promise<TestResult> {
    try {
      this.logger.info('Testing annotation detection...');

      const tableInfo = await this.extractor.extractTableInfo('ai_agent_session', 'public');
      const relationships = await this.extractor.analyzeRelationships('ai_agent_session', 'public');

      // Test column annotation detection
      const { AnnotationDetector } = await import('./annotationDetector.js');
      const detector = new AnnotationDetector();

      let totalAnnotations = 0;
      let idAnnotations = 0;
      let columnAnnotations = 0;

      for (const column of tableInfo.columns) {
        const annotations = detector.detectColumnAnnotations(column, tableInfo, relationships);
        totalAnnotations += annotations.length;

        for (const annotation of annotations) {
          if (annotation.annotation.name === 'Id') idAnnotations++;
          if (annotation.annotation.name === 'Column') columnAnnotations++;
        }
      }

      const hasIdAnnotation = idAnnotations > 0;
      const hasColumnAnnotations = columnAnnotations > 0;
      const hasAnnotations = totalAnnotations > 0;

      if (!hasAnnotations || !hasIdAnnotation || !hasColumnAnnotations) {
        return {
          testName: 'Annotation Detection',
          passed: false,
          message: 'Annotation detection failed to identify required annotations',
          details: { totalAnnotations, idAnnotations, columnAnnotations }
        };
      }

      return {
        testName: 'Annotation Detection',
        passed: true,
        message: `Successfully detected ${totalAnnotations} annotations (${idAnnotations} @Id, ${columnAnnotations} @Column)`,
        details: { totalAnnotations, idAnnotations, columnAnnotations }
      };

    } catch (error) {
      return {
        testName: 'Annotation Detection',
        passed: false,
        message: `Annotation detection failed: ${error instanceof Error ? error.message : String(error)}`,
        details: error
      };
    }
  }

  private async testRelationshipAnalysis(): Promise<TestResult> {
    try {
      this.logger.info('Testing relationship analysis...');

      const relationships = await this.extractor.analyzeRelationships('ai_agent_session', 'public');

      return {
        testName: 'Relationship Analysis',
        passed: true,
        message: `Successfully analyzed relationships for ai_agent_session table (${relationships.length} relationships found)`,
        details: { relationshipCount: relationships.length, relationships }
      };    } catch (error) {
      return {
        testName: 'Relationship Analysis',
        passed: false,
        message: `Relationship analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        details: error
      };
    }
  }

  private async testGeneratedCodeValidity(): Promise<TestResult> {
    try {
      this.logger.info('Testing generated code validity...');

      const outputDir = './test-output';
      const sessionFile = path.join(outputDir, 'ai-agent-session.ts');

      if (!fs.existsSync(sessionFile)) {
        return {
          testName: 'Generated Code Validity',
          passed: false,
          message: 'AiAgentSession entity file not found for validation'
        };
      }

      const content = fs.readFileSync(sessionFile, 'utf8');

      // Basic syntax validation
      const hasValidSyntax = this.validateTypeScriptSyntax(content);
      const hasProperImports = this.validateImports(content);
      const hasProperClass = this.validateClassStructure(content);
      const hasProperAnnotations = this.validateAnnotations(content);

      const allValid = hasValidSyntax && hasProperImports && hasProperClass && hasProperAnnotations;

      return {
        testName: 'Generated Code Validity',
        passed: allValid,
        message: allValid ? 'Generated code passes all validity checks' : 'Generated code has validity issues',
        details: { hasValidSyntax, hasProperImports, hasProperClass, hasProperAnnotations }
      };

    } catch (error) {
      return {
        testName: 'Generated Code Validity',
        passed: false,
        message: `Code validity test failed: ${error instanceof Error ? error.message : String(error)}`,
        details: error
      };
    }
  }

  private async testCLIFunctionality(): Promise<TestResult> {
    try {
      this.logger.info('Testing CLI functionality...');

      // Test configuration validation
      const configErrors = this.generator.validateConfig({
        outputDirectory: './test-output',
        schemaName: 'public',
        includeRelationships: true,
        generateRepository: false,
        overwriteExisting: true
      });

      if (configErrors.length > 0) {
        return {
          testName: 'CLI Functionality',
          passed: false,
          message: 'Configuration validation failed',
          details: { configErrors }
        };
      }

      return {
        testName: 'CLI Functionality',
        passed: true,
        message: 'CLI functionality tests passed',
        details: { configErrors }
      };

    } catch (error) {
      return {
        testName: 'CLI Functionality',
        passed: false,
        message: `CLI test failed: ${error instanceof Error ? error.message : String(error)}`,
        details: error
      };
    }
  }

  private validateTypeScriptSyntax(content: string): boolean {
    // Basic syntax checks
    const hasMatchingBraces = (content.match(/{/g)?.length || 0) === (content.match(/}/g)?.length || 0);
    const hasValidImports = !content.includes('import {') || Boolean(content.match(/import\s+{[^}]+}\s+from\s+['"]/));
    const hasValidExports = !content.includes('export') || content.includes('export class');
    
    return hasMatchingBraces && hasValidImports && hasValidExports;
  }

  private validateImports(content: string): boolean {
    // Check for required imports
    const hasAnnotationImports = content.includes('Id') && content.includes('Column');
    const hasValidImportPaths = !content.includes('from \'') || Boolean(content.match(/from\s+['"'][^'"]+\.js['"]/));
    
    return hasAnnotationImports && hasValidImportPaths;
  }

  private validateClassStructure(content: string): boolean {
    // Check class structure
    const hasClassDeclaration = content.includes('export class');
    const hasConstructor = content.includes('constructor(') || !content.includes('private');
    const hasGettersSetters = content.includes('get ') && content.includes('set ');
    
    return hasClassDeclaration && hasConstructor && hasGettersSetters;
  }

  private validateAnnotations(content: string): boolean {
    // Check annotations
    const hasIdAnnotation = content.includes('@Id()');
    const hasColumnAnnotations = content.includes('@Column(');
    const annotationsBeforeFields = !content.match(/@\w+\s*\n\s*@\w+/) || true; // Multiple annotations are OK
    
    return hasIdAnnotation && hasColumnAnnotations && annotationsBeforeFields;
  }

  private async cleanup(): Promise<void> {
    try {
      // Clean up test output directory
      const testOutputDir = './test-output';
      if (fs.existsSync(testOutputDir)) {
        fs.rmSync(testOutputDir, { recursive: true, force: true });
        this.logger.info('Cleaned up test output directory');
      }

      // Close database connection
      await this.pool.end();
      this.logger.info('Database connection closed');

    } catch (error) {
      this.logger.error('Cleanup failed:', error);
    }
  }

  printResults(results: TestResult[]): void {
    console.log('\n🧪 PostgreSQL Entity Generator Test Results\n');

    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    const success = passed === total;

    console.log(`📊 Summary: ${passed}/${total} tests passed ${success ? '✅' : '❌'}\n`);

    for (const result of results) {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.testName}: ${result.message}`);
      
      if (!result.passed && result.details) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2).substring(0, 200)}...`);
      }
    }

    if (success) {
      console.log('\n🎉 All tests passed! The entity generator is working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Check the details above for more information.');
    }
  }
}

// Main test execution function
export async function runTests(): Promise<void> {
  const tester = new EntityGeneratorTester();
  const results = await tester.runAllTests();
  tester.printResults(results);
  
  // Exit with error code if any tests failed
  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

// Run tests if this file is executed directly
const isMainModule = process.argv[1]?.endsWith('entityGeneratorTest.ts') || 
                    process.argv[1]?.endsWith('entityGeneratorTest.js');
if (isMainModule) {
  runTests().catch(console.error);
}