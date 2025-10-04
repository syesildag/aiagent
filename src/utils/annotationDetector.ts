import { ColumnInfo, ForeignKeyInfo, RelationshipInfo, TableInfo } from './dbMetadataExtractor.js';

export interface AnnotationInfo {
  name: string;
  parameters?: Record<string, any>;
  imports: string[];
}

export interface ConstraintBasedAnnotation {
  annotation: AnnotationInfo;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

/**
 * Annotation Detection and Generation Engine
 * 
 * This class analyzes database constraints and metadata to intelligently determine
 * the appropriate annotations (@Id, @Column, @OneToOne, @OneToMany) for entity properties.
 */
export class AnnotationDetector {
  
  /**
   * Detect all annotations for a column based on database constraints
   */
  detectColumnAnnotations(
    column: ColumnInfo, 
    tableInfo: TableInfo,
    allRelationships: RelationshipInfo[]
  ): ConstraintBasedAnnotation[] {
    const annotations: ConstraintBasedAnnotation[] = [];

    // Detect @Id annotation
    const idAnnotation = this.detectIdAnnotation(column, tableInfo);
    if (idAnnotation) {
      annotations.push(idAnnotation);
    }

    // Detect @Column annotation
    const columnAnnotation = this.detectColumnAnnotation(column, tableInfo);
    if (columnAnnotation) {
      annotations.push(columnAnnotation);
    }

    return annotations;
  }

  /**
   * Detect relationship annotations based on foreign key constraints
   */
  detectRelationshipAnnotations(
    relationships: RelationshipInfo[],
    tableInfo: TableInfo
  ): ConstraintBasedAnnotation[] {
    const annotations: ConstraintBasedAnnotation[] = [];

    for (const relationship of relationships) {
      const annotation = this.detectRelationshipAnnotation(relationship, tableInfo);
      if (annotation) {
        annotations.push(annotation);
      }
    }

    return annotations;
  }

  /**
   * Detect @Id annotation for primary key columns
   */
  private detectIdAnnotation(
    column: ColumnInfo, 
    tableInfo: TableInfo
  ): ConstraintBasedAnnotation | null {
    if (!column.isPrimary) {
      return null;
    }

    const parameters: Record<string, any> = {};
    let confidence: 'high' | 'medium' | 'low' = 'high';
    let reasoning = `Column '${column.name}' is a primary key`;

    // Enhanced reasoning based on column characteristics
    if (column.isIdentity) {
      reasoning += ' with IDENTITY property (auto-increment)';
      parameters.generated = true;
    }

    if (column.isGenerated) {
      reasoning += ' and is a generated column';
      parameters.generated = true;
    }

    // Check for composite primary keys
    if (tableInfo.primaryKeys.length > 1) {
      reasoning += ` (part of composite key with ${tableInfo.primaryKeys.length} columns)`;
      confidence = 'medium'; // Composite keys might need special handling
    }

    return {
      annotation: {
        name: 'Id',
        parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
        imports: ['Id']
      },
      confidence,
      reasoning
    };
  }

  /**
   * Detect @Column annotation with appropriate parameters
   */
  private detectColumnAnnotation(
    column: ColumnInfo,
    tableInfo: TableInfo
  ): ConstraintBasedAnnotation | null {
    const parameters: Record<string, any> = {};
    let reasoning = `Column '${column.name}' requires @Column annotation`;

    // Nullable configuration
    if (!column.isNullable) {
      parameters.nullable = false;
      reasoning += ', not nullable';
    }

    // Length constraints for string types
    if (column.maxLength && column.maxLength > 0) {
      parameters.length = column.maxLength;
      reasoning += `, max length: ${column.maxLength}`;
    }

    // Precision and scale for numeric types
    if (column.precision !== null && column.precision !== undefined) {
      parameters.precision = column.precision;
      reasoning += `, precision: ${column.precision}`;

      if (column.scale !== null && column.scale !== undefined) {
        parameters.scale = column.scale;
        reasoning += `, scale: ${column.scale}`;
      }
    }

    // Default values
    if (column.hasDefault) {
      parameters.hasDefault = true;
      reasoning += ', has default value';
    }

    // Unique constraints (detected from indexes or unique constraints)
    const isUniqueColumn = this.isColumnUnique(column, tableInfo);
    if (isUniqueColumn) {
      parameters.unique = true;
      reasoning += ', unique constraint';
    }

    return {
      annotation: {
        name: 'Column',
        parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
        imports: ['Column']
      },
      confidence: 'high',
      reasoning
    };
  }

  /**
   * Detect relationship annotations (@OneToOne, @OneToMany)
   */
  private detectRelationshipAnnotation(
    relationship: RelationshipInfo,
    tableInfo: TableInfo
  ): ConstraintBasedAnnotation | null {
    const parameters: Record<string, any> = {};
    let confidence: 'high' | 'medium' | 'low' = 'high';
    let reasoning = `${relationship.type} relationship detected via foreign key '${relationship.foreignKey.constraintName}'`;

    // Add target entity factory function
    parameters.target = `() => ${relationship.targetEntity}`;

    // Cascade options based on foreign key constraints
    const cascadeOptions = this.determineCascadeOptions(relationship.foreignKey);
    if (cascadeOptions.length > 0) {
      parameters.cascade = cascadeOptions;
      reasoning += `, cascade: [${cascadeOptions.join(', ')}]`;
    }

    // Lazy loading configuration
    if (!cascadeOptions.includes('persist') && !cascadeOptions.includes('merge')) {
      parameters.lazy = true;
      reasoning += ', lazy loading enabled';
    }

    // Foreign key column mapping for owning side
    if (relationship.isOwning) {
      parameters.joinColumn = {
        name: relationship.foreignKey.columnName,
        referencedColumnName: relationship.foreignKey.referencedColumn
      };
      reasoning += ` (owning side, FK: ${relationship.foreignKey.columnName})`;
    } else {
      // Mapped by property for inverse side
      const mappedByProperty = this.inferMappedByProperty(relationship);
      if (mappedByProperty) {
        parameters.mappedBy = mappedByProperty;
        reasoning += ` (inverse side, mapped by: ${mappedByProperty})`;
      }
    }

    // Relationship type specific logic
    if (relationship.type === 'OneToOne') {
      // OneToOne specific validations
      confidence = this.validateOneToOneRelationship(relationship, tableInfo);
      if (confidence === 'low') {
        reasoning += ' (Warning: relationship cardinality may not be truly one-to-one)';
      }
    } else if (relationship.type === 'OneToMany') {
      // OneToMany specific validations
      if (relationship.isOwning) {
        confidence = 'medium';
        reasoning += ' (Warning: OneToMany on owning side is unusual)';
      }
    }

    return {
      annotation: {
        name: relationship.type,
        parameters,
        imports: [relationship.type]
      },
      confidence,
      reasoning
    };
  }

  /**
   * Determine cascade options based on foreign key constraint actions
   */
  private determineCascadeOptions(foreignKey: ForeignKeyInfo): string[] {
    const cascadeOptions: string[] = [];

    // Map PostgreSQL constraint actions to cascade options
    switch (foreignKey.deleteAction) {
      case 'CASCADE':
        cascadeOptions.push('remove');
        break;
      case 'SET NULL':
        cascadeOptions.push('detach');
        break;
      // NO ACTION and RESTRICT don't require cascade options
    }

    switch (foreignKey.updateAction) {
      case 'CASCADE':
        cascadeOptions.push('update');
        break;
      // Other actions typically don't need special cascade handling
    }

    return cascadeOptions;
  }

  /**
   * Validate OneToOne relationship confidence
   */
  private validateOneToOneRelationship(
    relationship: RelationshipInfo,
    tableInfo: TableInfo
  ): 'high' | 'medium' | 'low' {
    // Check if the foreign key column has a unique constraint
    const fkColumn = tableInfo.columns.find(col => 
      col.name === relationship.foreignKey.columnName
    );

    if (!fkColumn) {
      return 'low';
    }

    // Check for unique constraint on the foreign key column
    const hasUniqueConstraint = this.isColumnUnique(fkColumn, tableInfo);
    
    if (hasUniqueConstraint) {
      return 'high';
    }

    // If no unique constraint, it might not be a true OneToOne
    return 'low';
  }

  /**
   * Infer the mappedBy property name for inverse relationships
   */
  private inferMappedByProperty(relationship: RelationshipInfo): string | null {
    // Convert the source table name to camelCase for the mapped by property
    // This assumes the owning entity has a property named after the inverse entity
    const sourceTableName = relationship.foreignKey.referencedTable;
    return this.toCamelCase(sourceTableName);
  }

  /**
   * Check if a column has unique constraints
   */
  private isColumnUnique(column: ColumnInfo, tableInfo: TableInfo): boolean {
    // Check if the column is part of a single-column unique index
    return tableInfo.indexes.some(index => 
      index.isUnique && 
      index.columns.length === 1 && 
      index.columns[0] === column.name
    );
  }

  /**
   * Generate annotation string from annotation info
   */
  generateAnnotationString(annotation: AnnotationInfo): string {
    if (!annotation.parameters || Object.keys(annotation.parameters).length === 0) {
      return `@${annotation.name}()`;
    }

    const paramStrings = Object.entries(annotation.parameters).map(([key, value]) => {
      if (typeof value === 'string' && value.startsWith('() =>')) {
        // Function parameter - don't quote
        return `${key}: ${value}`;
      } else if (typeof value === 'string') {
        return `${key}: '${value}'`;
      } else if (Array.isArray(value)) {
        const arrayValues = value.map(v => typeof v === 'string' ? `'${v}'` : v).join(', ');
        return `${key}: [${arrayValues}]`;
      } else if (typeof value === 'object' && value !== null) {
        const objString = Object.entries(value)
          .map(([k, v]) => `${k}: '${v}'`)
          .join(', ');
        return `${key}: { ${objString} }`;
      } else {
        return `${key}: ${value}`;
      }
    });

    return `@${annotation.name}({ ${paramStrings.join(', ')} })`;
  }

  /**
   * Get all required imports from a list of annotations
   */
  getRequiredImports(annotations: ConstraintBasedAnnotation[]): string[] {
    const imports = new Set<string>();
    
    for (const annotation of annotations) {
      for (const imp of annotation.annotation.imports) {
        imports.add(imp);
      }
    }
    
    return Array.from(imports).sort();
  }

  /**
   * Analyze constraint confidence and provide recommendations
   */
  analyzeConstraintConfidence(annotations: ConstraintBasedAnnotation[]): {
    highConfidence: ConstraintBasedAnnotation[];
    mediumConfidence: ConstraintBasedAnnotation[];
    lowConfidence: ConstraintBasedAnnotation[];
    warnings: string[];
  } {
    const highConfidence = annotations.filter(a => a.confidence === 'high');
    const mediumConfidence = annotations.filter(a => a.confidence === 'medium');
    const lowConfidence = annotations.filter(a => a.confidence === 'low');
    
    const warnings: string[] = [];
    
    // Generate warnings for low confidence annotations
    for (const annotation of lowConfidence) {
      warnings.push(`Low confidence: ${annotation.reasoning}`);
    }
    
    // Generate warnings for medium confidence annotations
    for (const annotation of mediumConfidence) {
      warnings.push(`Medium confidence: ${annotation.reasoning}`);
    }

    return {
      highConfidence,
      mediumConfidence,
      lowConfidence,
      warnings
    };
  }

  /**
   * Convert string to camelCase
   */
  private toCamelCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map((word, index) => 
        index === 0 
          ? word.toLowerCase()
          : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      )
      .join('');
  }
}

/**
 * Advanced constraint analysis utilities
 */
export class ConstraintAnalyzer {
  
  /**
   * Analyze table relationships and suggest optimal annotation patterns
   */
  static analyzeTableRelationshipPatterns(
    tableInfo: TableInfo,
    allTables: TableInfo[]
  ): {
    patterns: string[];
    suggestions: string[];
    complexities: string[];
  } {
    const patterns: string[] = [];
    const suggestions: string[] = [];
    const complexities: string[] = [];

    // Analyze foreign key patterns
    if (tableInfo.foreignKeys.length === 0) {
      patterns.push('Independent Entity - No foreign key dependencies');
    } else if (tableInfo.foreignKeys.length === 1) {
      patterns.push('Simple Relationship - Single foreign key reference');
    } else {
      patterns.push(`Complex Entity - ${tableInfo.foreignKeys.length} foreign key relationships`);
      complexities.push('Multiple foreign keys may require careful cascade configuration');
    }

    // Check for self-referencing relationships
    const selfReferences = tableInfo.foreignKeys.filter(fk => 
      fk.referencedTable === tableInfo.tableName
    );
    
    if (selfReferences.length > 0) {
      patterns.push('Self-Referencing Entity - Hierarchical structure detected');
      suggestions.push('Consider using tree-like annotations or parent-child relationships');
    }

    // Analyze primary key complexity
    if (tableInfo.primaryKeys.length > 1) {
      patterns.push('Composite Primary Key - Multiple key columns');
      complexities.push('Composite keys may require @IdClass or @EmbeddedId annotations');
    } else if (tableInfo.primaryKeys.length === 0) {
      patterns.push('No Primary Key - Unusual table structure');
      suggestions.push('Consider adding a primary key for better entity mapping');
    }

    return { patterns, suggestions, complexities };
  }

  /**
   * Detect potential many-to-many relationships through junction tables
   */
  static detectManyToManyRelationships(
    tableInfo: TableInfo,
    allTables: TableInfo[]
  ): Array<{
    junctionTable: string;
    leftEntity: string;
    rightEntity: string;
    confidence: number;
  }> {
    const manyToManyRelationships: Array<{
      junctionTable: string;
      leftEntity: string;
      rightEntity: string;
      confidence: number;
    }> = [];

    // A junction table typically has:
    // 1. Exactly two foreign keys
    // 2. Composite primary key consisting of both foreign key columns
    // 3. No other significant columns

    if (
      tableInfo.foreignKeys.length === 2 &&
      tableInfo.primaryKeys.length === 2 &&
      tableInfo.columns.length <= 4 // Allow for a few additional metadata columns
    ) {
      const fk1 = tableInfo.foreignKeys[0];
      const fk2 = tableInfo.foreignKeys[1];
      
      // Check if primary key columns match foreign key columns
      const fkColumns = [fk1.columnName, fk2.columnName].sort();
      const pkColumns = tableInfo.primaryKeys.sort();
      
      const isJunctionTable = JSON.stringify(fkColumns) === JSON.stringify(pkColumns);
      
      if (isJunctionTable) {
        manyToManyRelationships.push({
          junctionTable: tableInfo.tableName,
          leftEntity: fk1.referencedTable,
          rightEntity: fk2.referencedTable,
          confidence: 0.9
        });
      }
    }

    return manyToManyRelationships;
  }
}