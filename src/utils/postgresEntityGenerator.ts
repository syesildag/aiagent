import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger.js';
import { DbMetadataExtractor, TableInfo, RelationshipInfo } from './dbMetadataExtractor.js';
import { TypeScriptCodeGenerator, EntityGenerationOptions, CodeGenerationUtils } from './typeScriptCodeGenerator.js';
import { AnnotationDetector, ConstraintBasedAnnotation, ConstraintAnalyzer } from './annotationDetector.js';

export interface EntityGenerationConfig {
  outputDirectory: string;
  schemaName?: string;
  baseClass?: string;
  includeRelationships: boolean;
  generateRepository: boolean;
  overwriteExisting: boolean;
  fileHeader?: string;
  generationOptions?: Partial<EntityGenerationOptions>;
}

export interface GenerationResult {
  success: boolean;
  entityFile: string;
  warnings: string[];
  errors: string[];
  metadata: {
    tableName: string;
    schemaName: string;
    columnCount: number;
    relationshipCount: number;
    annotationCount: number;
  };
}

export interface EntityGenerationReport {
  totalTables: number;
  successfulGenerations: number;
  failedGenerations: number;
  results: GenerationResult[];
  globalWarnings: string[];
  globalErrors: string[];
  executionTime: number;
}

/**
 * PostgreSQL Entity Generator
 * 
 * The main orchestrator that combines metadata extraction, annotation detection,
 * and code generation to automatically create TypeScript entity classes from
 * PostgreSQL table schemas.
 */
export class PostgreSQLEntityGenerator {
  private pool: Pool;
  private logger: Logger;
  private metadataExtractor: DbMetadataExtractor;
  private codeGenerator: TypeScriptCodeGenerator;
  private annotationDetector: AnnotationDetector;

  constructor(pool: Pool, logger: Logger) {
    this.pool = pool;
    this.logger = logger;
    this.metadataExtractor = new DbMetadataExtractor(pool, logger);
    this.codeGenerator = new TypeScriptCodeGenerator();
    this.annotationDetector = new AnnotationDetector();
  }

  /**
   * Generate a single entity class from a table name
   */
  async generateEntity(
    tableName: string,
    config: EntityGenerationConfig
  ): Promise<GenerationResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: string[] = [];
    
    try {
      this.logger.info(`Starting entity generation for table: ${tableName}`);

      // Step 1: Validate table exists
      const tableExists = await this.metadataExtractor.tableExists(
        tableName, 
        config.schemaName || 'public'
      );
      
      if (!tableExists) {
        const error = `Table '${tableName}' does not exist in schema '${config.schemaName || 'public'}'`;
        errors.push(error);
        this.logger.error(error);
        
        return {
          success: false,
          entityFile: '',
          warnings,
          errors,
          metadata: {
            tableName,
            schemaName: config.schemaName || 'public',
            columnCount: 0,
            relationshipCount: 0,
            annotationCount: 0
          }
        };
      }

      // Step 2: Extract table metadata
      this.logger.info(`Extracting metadata for table: ${tableName}`);
      const tableInfo = await this.metadataExtractor.extractTableInfo(
        tableName, 
        config.schemaName || 'public'
      );

      if (tableInfo.columns.length === 0) {
        const warning = `Table '${tableName}' has no columns`;
        warnings.push(warning);
        this.logger.warn(warning);
      }

      // Step 3: Analyze relationships if enabled
      let relationships: RelationshipInfo[] = [];
      if (config.includeRelationships) {
        this.logger.info(`Analyzing relationships for table: ${tableName}`);
        relationships = await this.metadataExtractor.analyzeRelationships(
          tableName, 
          config.schemaName || 'public'
        );
      }

      // Step 4: Detect annotations
      this.logger.info(`Detecting annotations for table: ${tableName}`);
      const columnAnnotations = tableInfo.columns.flatMap(column =>
        this.annotationDetector.detectColumnAnnotations(column, tableInfo, relationships)
      );

      const relationshipAnnotations = this.annotationDetector.detectRelationshipAnnotations(
        relationships, 
        tableInfo
      );

      const allAnnotations = [...columnAnnotations, ...relationshipAnnotations];

      // Step 5: Analyze constraint confidence
      const confidenceAnalysis = this.annotationDetector.analyzeConstraintConfidence(allAnnotations);
      warnings.push(...confidenceAnalysis.warnings);

      // Step 6: Analyze table patterns
      const patternAnalysis = ConstraintAnalyzer.analyzeTableRelationshipPatterns(
        tableInfo, 
        [tableInfo] // For now, we only have this table's info
      );
      
      if (patternAnalysis.suggestions.length > 0) {
        warnings.push(...patternAnalysis.suggestions);
      }
      
      if (patternAnalysis.complexities.length > 0) {
        warnings.push(...patternAnalysis.complexities);
      }

      // Step 7: Generate TypeScript entity code
      this.logger.info(`Generating TypeScript code for entity: ${tableName}`);
      
      const generationOptions: EntityGenerationOptions = {
        ...this.codeGenerator.getDefaultOptions(),
        ...config.generationOptions,
        baseClass: config.baseClass
      };

      const entityCode = this.codeGenerator.generateEntityClass(
        tableInfo,
        relationships,
        generationOptions
      );

      // Step 8: Add file header if specified
      let finalCode = entityCode;
      if (config.fileHeader) {
        finalCode = config.fileHeader + '\n' + entityCode;
      } else {
        const className = this.toPascalCase(tableName);
        const header = CodeGenerationUtils.generateFileHeader(
          `${className}.ts`,
          `Entity class generated from PostgreSQL table: ${config.schemaName || 'public'}.${tableName}`
        );
        finalCode = header + entityCode;
      }

      // Step 9: Format the code
      finalCode = CodeGenerationUtils.formatTypeScriptCode(finalCode);

      // Step 10: Write to file
      const className = this.toPascalCase(tableName);
      const fileName = `${this.toKebabCase(className)}.ts`;
      const fullPath = path.join(config.outputDirectory, fileName);

      // Check if file exists and handle overwrite
      if (fs.existsSync(fullPath) && !config.overwriteExisting) {
        const warning = `File '${fullPath}' already exists. Use overwriteExisting: true to replace it.`;
        warnings.push(warning);
        this.logger.warn(warning);
      } else {
        // Ensure output directory exists
        fs.mkdirSync(config.outputDirectory, { recursive: true });
        
        // Write the file
        fs.writeFileSync(fullPath, finalCode, 'utf8');
        this.logger.info(`Entity file generated: ${fullPath}`);
      }

      const executionTime = Date.now() - startTime;
      this.logger.info(`Entity generation completed for '${tableName}' in ${executionTime}ms`);

      return {
        success: true,
        entityFile: fullPath,
        warnings,
        errors,
        metadata: {
          tableName,
          schemaName: config.schemaName || 'public',
          columnCount: tableInfo.columns.length,
          relationshipCount: relationships.length,
          annotationCount: allAnnotations.length
        }
      };

    } catch (error) {
      const errorMessage = `Failed to generate entity for table '${tableName}': ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMessage);
      this.logger.error(errorMessage, error);

      return {
        success: false,
        entityFile: '',
        warnings,
        errors,
        metadata: {
          tableName,
          schemaName: config.schemaName || 'public',
          columnCount: 0,
          relationshipCount: 0,
          annotationCount: 0
        }
      };
    }
  }

  /**
   * Generate entities for multiple tables
   */
  async generateEntities(
    tableNames: string[],
    config: EntityGenerationConfig
  ): Promise<EntityGenerationReport> {
    const startTime = Date.now();
    this.logger.info(`Starting batch entity generation for ${tableNames.length} tables`);

    const results: GenerationResult[] = [];
    const globalWarnings: string[] = [];
    const globalErrors: string[] = [];

    let successfulGenerations = 0;
    let failedGenerations = 0;

    // Generate entities sequentially to avoid database connection issues
    for (const tableName of tableNames) {
      try {
        const result = await this.generateEntity(tableName, config);
        results.push(result);

        if (result.success) {
          successfulGenerations++;
        } else {
          failedGenerations++;
          globalErrors.push(`Failed to generate entity for table '${tableName}'`);
        }

      } catch (error) {
        const errorMessage = `Unexpected error generating entity for table '${tableName}': ${error instanceof Error ? error.message : String(error)}`;
        globalErrors.push(errorMessage);
        this.logger.error(errorMessage, error);
        failedGenerations++;

        // Add a failed result
        results.push({
          success: false,
          entityFile: '',
          warnings: [],
          errors: [errorMessage],
          metadata: {
            tableName,
            schemaName: config.schemaName || 'public',
            columnCount: 0,
            relationshipCount: 0,
            annotationCount: 0
          }
        });
      }
    }

    const executionTime = Date.now() - startTime;
    this.logger.info(`Batch entity generation completed in ${executionTime}ms. Success: ${successfulGenerations}, Failed: ${failedGenerations}`);

    return {
      totalTables: tableNames.length,
      successfulGenerations,
      failedGenerations,
      results,
      globalWarnings,
      globalErrors,
      executionTime
    };
  }

  /**
   * Generate entities for all tables in a schema
   */
  async generateEntitiesForSchema(
    config: EntityGenerationConfig
  ): Promise<EntityGenerationReport> {
    this.logger.info(`Discovering tables in schema: ${config.schemaName || 'public'}`);

    try {
      const tableNames = await this.metadataExtractor.getTablesInSchema(
        config.schemaName || 'public'
      );

      if (tableNames.length === 0) {
        this.logger.warn(`No tables found in schema: ${config.schemaName || 'public'}`);
        return {
          totalTables: 0,
          successfulGenerations: 0,
          failedGenerations: 0,
          results: [],
          globalWarnings: [`No tables found in schema: ${config.schemaName || 'public'}`],
          globalErrors: [],
          executionTime: 0
        };
      }

      this.logger.info(`Found ${tableNames.length} tables in schema: ${config.schemaName || 'public'}`);
      return await this.generateEntities(tableNames, config);

    } catch (error) {
      const errorMessage = `Failed to discover tables in schema '${config.schemaName || 'public'}': ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(errorMessage, error);

      return {
        totalTables: 0,
        successfulGenerations: 0,
        failedGenerations: 1,
        results: [],
        globalWarnings: [],
        globalErrors: [errorMessage],
        executionTime: 0
      };
    }
  }

  /**
   * Generate an index file that exports all generated entities
   */
  async generateIndexFile(
    config: EntityGenerationConfig,
    generatedFiles: string[]
  ): Promise<void> {
    if (generatedFiles.length === 0) {
      this.logger.warn('No entity files to include in index');
      return;
    }

    const indexPath = path.join(config.outputDirectory, 'index.ts');
    const exports = generatedFiles.map(filePath => {
      const fileName = path.basename(filePath, '.ts');
      const className = this.toPascalCase(fileName.replace(/-/g, '_'));
      return `export { ${className} } from './${fileName}.js';`;
    });

    const indexContent = [
      CodeGenerationUtils.generateFileHeader(
        'index.ts',
        'Auto-generated index file for all entities'
      ),
      ...exports
    ].join('\n');

    fs.writeFileSync(indexPath, indexContent, 'utf8');
    this.logger.info(`Index file generated: ${indexPath}`);
  }

  /**
   * Get default generation configuration
   */
  getDefaultConfig(): EntityGenerationConfig {
    return {
      outputDirectory: './src/entities',
      schemaName: 'public',
      baseClass: 'Entity',
      includeRelationships: true,
      generateRepository: false,
      overwriteExisting: false,
      generationOptions: {
        includeImports: true,
        includeConstructor: true,
        includeGettersSetters: true,
        includeToString: true,
        includeValidation: false
      }
    };
  }

  /**
   * Validate generation configuration
   */
  validateConfig(config: EntityGenerationConfig): string[] {
    const errors: string[] = [];

    if (!config.outputDirectory || config.outputDirectory.trim() === '') {
      errors.push('outputDirectory is required');
    }

    if (!path.isAbsolute(config.outputDirectory)) {
      // Convert to absolute path
      config.outputDirectory = path.resolve(config.outputDirectory);
    }

    if (config.schemaName && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.schemaName)) {
      errors.push('schemaName must be a valid PostgreSQL identifier');
    }

    return errors;
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Convert string to kebab-case
   */
  private toKebabCase(str: string): string {
    return str
      .split(/(?=[A-Z])/)
      .join('-')
      .toLowerCase()
      .replace(/^-/, '');
  }
}

/**
 * CLI Interface for the Entity Generator
 */
export class EntityGeneratorCLI {
  private generator: PostgreSQLEntityGenerator;

  constructor(generator: PostgreSQLEntityGenerator) {
    this.generator = generator;
  }

  /**
   * Parse command line arguments and execute generation
   */
  async executeFromArgs(args: string[]): Promise<void> {
    const config = this.parseArgs(args);
    const configErrors = this.generator.validateConfig(config);

    if (configErrors.length > 0) {
      console.error('Configuration errors:');
      configErrors.forEach(error => console.error(`  - ${error}`));
      process.exit(1);
    }

    if (args.includes('--table')) {
      // Generate single table
      const tableIndex = args.indexOf('--table');
      const tableName = args[tableIndex + 1];
      
      if (!tableName) {
        console.error('Table name is required with --table option');
        process.exit(1);
      }

      const result = await this.generator.generateEntity(tableName, config);
      this.printSingleResult(result);

    } else if (args.includes('--schema')) {
      // Generate all tables in schema
      const result = await this.generator.generateEntitiesForSchema(config);
      this.printBatchResult(result);

    } else {
      console.error('Either --table <name> or --schema must be specified');
      process.exit(1);
    }
  }

  /**
   * Parse command line arguments into configuration
   */
  private parseArgs(args: string[]): EntityGenerationConfig {
    const config = this.generator.getDefaultConfig();

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      switch (arg) {
        case '--output':
        case '-o':
          if (nextArg) config.outputDirectory = nextArg;
          break;
        case '--schema':
        case '-s':
          if (nextArg) config.schemaName = nextArg;
          break;
        case '--base-class':
          if (nextArg) config.baseClass = nextArg;
          break;
        case '--no-relationships':
          config.includeRelationships = false;
          break;
        case '--overwrite':
          config.overwriteExisting = true;
          break;
      }
    }

    return config;
  }

  /**
   * Print result for single entity generation
   */
  private printSingleResult(result: GenerationResult): void {
    if (result.success) {
      console.log(`✅ Entity generated successfully: ${result.entityFile}`);
      console.log(`   Columns: ${result.metadata.columnCount}`);
      console.log(`   Relationships: ${result.metadata.relationshipCount}`);
      console.log(`   Annotations: ${result.metadata.annotationCount}`);
    } else {
      console.log(`❌ Entity generation failed for: ${result.metadata.tableName}`);
    }

    if (result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      result.warnings.forEach(warning => console.log(`   - ${warning}`));
    }

    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach(error => console.log(`   - ${error}`));
    }
  }

  /**
   * Print result for batch generation
   */
  private printBatchResult(result: EntityGenerationReport): void {
    console.log(`\n📊 Generation Summary:`);
    console.log(`   Total tables: ${result.totalTables}`);
    console.log(`   Successful: ${result.successfulGenerations}`);
    console.log(`   Failed: ${result.failedGenerations}`);
    console.log(`   Execution time: ${result.executionTime}ms`);

    if (result.successfulGenerations > 0) {
      console.log('\n✅ Successfully generated entities:');
      result.results
        .filter(r => r.success)
        .forEach(r => console.log(`   - ${path.basename(r.entityFile)}`));
    }

    if (result.failedGenerations > 0) {
      console.log('\n❌ Failed entities:');
      result.results
        .filter(r => !r.success)
        .forEach(r => console.log(`   - ${r.metadata.tableName}`));
    }

    const allWarnings = [
      ...result.globalWarnings,
      ...result.results.flatMap(r => r.warnings)
    ];

    if (allWarnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      allWarnings.forEach(warning => console.log(`   - ${warning}`));
    }

    const allErrors = [
      ...result.globalErrors,
      ...result.results.flatMap(r => r.errors)
    ];

    if (allErrors.length > 0) {
      console.log('\n❌ Errors:');
      allErrors.forEach(error => console.log(`   - ${error}`));
    }
  }
}